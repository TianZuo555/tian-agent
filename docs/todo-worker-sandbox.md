# Worker OS Sandbox on macOS Seatbelt (TODO & Implementation Plan)

**English** | [简体中文](zh/todo-worker-sandbox.md)

This document tracks the plan to put every Worker command inside a macOS Seatbelt sandbox (`sandbox-exec`). It answers PRD §13 question 8 ("How are Worker write permissions restricted?").

---

## 1. Problem

- A Worker has `CodingTools` (bash, read, write, edit) and runs with the full rights of the macOS user.
- "Edit only the current directory" is a prompt instruction only ([architecture.md](architecture.md#permissions-and-scopes)). Git worktrees isolate branches, not the file system.
- Untrusted text can reach a Worker: Telegram and WeChat messages (allow-listed), `.tian/inbox` files inside a project, and web pages or files that a Worker reads. A prompt injection can make a Worker write outside its worktree, read secrets, or send data out.
- A Worker runs as the same macOS user as the service, so it can connect to the service socket (mode 0600) and send any command: approve a skill, land or ship a Run, or change project settings.
- Before Phase 0, every Worker shell command inherited the full service environment. The service loads `service.env` into `process.env` (`src/service/entry.ts`), and Pi's `NodeExecutionEnv` passes `process.env` to each child process, so a Worker command could read `TELEGRAM_BOT_TOKEN`, `MAGPIE_API_KEY`, and the WeChat settings. Phase 0 removed these variables (`agentShellEnv` in `src/worker/agents.ts`).

## 2. Why Seatbelt, and Memory Cost

Seatbelt is the macOS kernel sandbox. `sandbox-exec` applies a profile to its own process and then `exec`s the command, so the command keeps the same PID and runs no extra process. Child processes inherit the profile. There is no virtual machine.

| Option                               | Mechanism                    | Extra memory per Worker | Decision                                                 |
| ------------------------------------ | ---------------------------- | ----------------------- | -------------------------------------------------------- |
| Seatbelt (`sandbox-exec`)            | Kernel policy on the process | About zero              | **Use**                                                  |
| Containers (Docker, Apple container) | Linux VM on macOS            | Hundreds of MB or more  | Reject: memory, and macOS toolchains do not run in Linux |
| macOS VM (Virtualization.framework)  | Full guest OS                | Several GB              | Reject: memory, and at most two macOS guests per host    |

Measured on 2026-10-25: the resident service used about 30 MB RSS with 16 conversations. Magpie used about 318 MB plus about 348 MB for its plugin host, shared by all Workers. A Worker is a Pi conversation inside the service process, not a separate process. Memory pressure with 8–10 parallel Workers comes from the commands they run (`pnpm install`, `tsc`, builds, test runners, dev servers). Seatbelt does not change that cost. The global attempt cap (Settings → Workers, default 3) is the control for memory, not the sandbox.

Precedent: Bazel's macOS sandbox runs many concurrent build actions under `sandbox-exec` with the same profile pattern as section 4. Codex CLI and Claude Code also use Seatbelt on macOS.

## 3. Design

### 3.1 Where to hook

- `AgentRuntime.open` builds each conversation's environment through the Harness `env` factory (`src/worker/agents.ts`). The factory receives `{ conversationId, cwd }` on each use.
- The factory looks up `db.runByConversation(conversationId)`. Only Worker conversations get a sandbox. Chief and Manager conversations have no shell tools and keep the plain `NodeExecutionEnv`.
- A new `SandboxedExecutionEnv` (new module `src/worker/sandbox.ts`) implements Pi's `ExecutionEnv` and delegates to an inner `NodeExecutionEnv`.

### 3.2 Commands (`exec`)

`NodeExecutionEnv.exec` accepts two shapes: a string runs through the shell (`<shell> -c <command>`), and an argv array spawns its program directly without a shell. A `shellPath` wrapper alone does not cover argv calls. Therefore `SandboxedExecutionEnv.exec` rewrites both shapes to argv:

- String: `['/usr/bin/sandbox-exec', '-f', profile, '/bin/bash', '-c', command]`
- Array: `['/usr/bin/sandbox-exec', '-f', profile, ...argv]`

It passes `inheritEnv: false` with a scrubbed environment (section 3.5). Abort still works: Pi spawns a detached process group and kills the tree, and `sandbox-exec` keeps the PID.

### 3.3 File tools (in process)

Pi's read, write, and edit tools call `ExecutionEnv` file methods inside the service process. Seatbelt does not see them. `SandboxedExecutionEnv` checks paths itself:

- Write methods (`writeFile`, `appendFile`, `truncateFile`, `renameFile` (both paths), `createDir`, `remove`): resolve with `canonicalPath` (follow symlinks; for a new file, canonicalize the parent) and allow only paths under the writable roots of section 4.
- Read methods (`readTextFile`, `readTextLines`, `openTextLineReader`, `readBinaryFile`, `openBinaryReader`, `listDir`, `openDirReader`, `fileInfo`, `exists`): reject the denied read paths of section 4.
- A rejection returns a `FileError` with a clear message. It does not throw.

### 3.4 Profile

The service generates one profile file per run at `<dataDir>/sandbox/<runId>.sb`, with canonical absolute paths. It escapes `\` and `"` in every path. The file stays for audit and debugging. A Worker cannot read it, because `<dataDir>` is a denied read path.

### 3.5 Environment

The child environment starts from `process.env` minus `TELEGRAM_*`, `WECHAT_*`, `MAGPIE_*`, and `TIAN_AGENT_*`. A project setting can add more names to remove. This step is independent of Seatbelt and ships first (Phase 0).

### 3.6 Project settings

| Setting             | Values                              | Default (Phase 1 → Phase 3) |
| ------------------- | ----------------------------------- | --------------------------- |
| `sandboxMode`       | `off` / `workspace-write`           | `off` → `workspace-write`   |
| `sandboxNetwork`    | `on` / `off` (localhost stays open) | `on`                        |
| `sandboxExtraWrite` | Absolute paths, one per line        | Empty                       |
| `sandboxAllowRead`  | Paths removed from the deny list    | Empty                       |

These need new `projects` columns (a `DATABASE_VERSION` bump; the database is snapshotted and recreated), the `updateProject` patch schema in `src/shared/contracts.ts`, `ProjectSettings` in `src/shared/types.ts`, `ProjectSettingsDialog.tsx`, and i18n keys in `en.ts` and `zh.ts`.

### 3.7 Fail closed

At service start, run a self-test: `sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`. If `/usr/bin/sandbox-exec` is missing or the test fails, a project with `sandboxMode = workspace-write` refuses to start Runs with a clear error. It never falls back to an unsandboxed Run in silence. The `sandbox-exec` man page marks the tool as deprecated, but macOS still ships it; the self-test catches a future removal.

## 4. Profile Rules

The pattern follows Bazel: allow by default, then deny, then allow again. Later rules take precedence over earlier rules; Phase 0 must confirm this with tests.

```scheme
(version 1)
(allow default)

; Network: only when sandboxNetwork = off. Localhost stays open for dev servers and tests.
(deny network*)
(allow network* (local ip "localhost:*") (remote ip "localhost:*") (remote unix-socket))

; Service socket: closed in every mode. It accepts every service command.
(deny network-outbound (remote unix-socket (path-literal "<socketPath>")))

; Secrets: no reads or writes of service data or credentials.
(deny file-read* file-write*
  (subpath "<dataDir>")                 ; service.env, tian.db, pi-session.sqlite, other Runs' worktrees
  (subpath "<home>/.ssh")
  (subpath "<home>/.aws")
  (subpath "<home>/.gnupg")
  (subpath "<home>/.config/gh")
  (subpath "<home>/.docker")
  (subpath "<home>/.kube")
  (subpath "<home>/Library/Keychains")
  (literal "<home>/.netrc")
  (literal "<home>/.npmrc"))

; Writes: deny everywhere, then allow the Run's roots.
(deny file-write*)
(allow file-write*
  (subpath "<workRoot>")                ; worktree, or rootPath for an in-place Run
  (subpath "<worktreeGitDir>")          ; <repo>/.git/worktrees/<runId>: index and locks
  (subpath "<tmpDir>")                  ; canonical $TMPDIR (/private/var/folders/.../T)
  (subpath "<userCacheDir>")            ; $TMPDIR's sibling C dir: clang/swift module cache
  (subpath "/private/tmp")
  (subpath "<home>/Library/Caches")
  (subpath "<home>/.cache")
  (subpath "<home>/.npm")
  (subpath "<home>/Library/pnpm")
  (subpath "<home>/.local/share/pnpm")
  (subpath "<home>/.local/share/mise")
  (subpath "<home>/.cargo/registry")
  (subpath "<home>/go/pkg/mod")
  (subpath "<home>/Library/Developer/Xcode/DerivedData")
  (subpath "<home>/Library/org.swift.swiftpm")
  ; plus each sandboxExtraWrite path
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty")
  (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))

; The work root lives under <dataDir>/worktrees: allow it again after the secrets rule.
(allow file-read* (subpath "<workRoot>") (subpath "<worktreeGitDir>"))
```

Result for a worktree Run:

- The main checkout (`rootPath`) stays readable but not writable, so `memory/MEMORY.md` and `notes/` are read-only, as the Worker instructions already say.
- A Worker cannot read other Runs' worktrees, the service database, or tokens.
- A Worker cannot connect to the service socket.
- `git status` and `git diff` work. `git add` and `git stash` fail, because `<repo>/.git/objects` is not writable. The application commits for the Worker (`commitAll` runs in the service, outside the sandbox).

## 5. Known Incompatibilities to Verify

- **Nested sandboxes**: verified — `sandbox_apply` inside Seatbelt always fails, even under `(allow default)`. SwiftPM sandboxes its `Package.swift` manifest and plugin evaluation, so plain `swift build` fails; `swift build --disable-sandbox` builds fine inside the outer profile. The Worker instructions name this flag. `xcodebuild` needs the same check.
- **Chromium-based tools** (Electron, Playwright, Puppeteer) start their own sandbox. Inside Seatbelt they may need `--no-sandbox`. This repo's `pnpm test:runtime` and `pnpm test:app-upgrade` start Electron.
- **Tools that write outside the roots**: global installs (`npm i -g`, `brew`), `mise install` into a custom path, and language servers with custom cache paths. The fix is `sandboxExtraWrite`, not a wider default.
- **Private registries**: `~/.npmrc` is denied by default because it can hold tokens. A project that needs it uses `sandboxAllowRead`.

## 5a. Measured Overhead (2026-…)

`mise` MacBook, 100 sequential spawns of `/usr/bin/true`:

- unsandboxed: **225 ms** total (~2.3 ms/spawn)
- `sandbox-exec -f <profile>`: **1 215 ms** total (~12.2 ms/spawn)

≈ **10 ms** fixed cost per command spawn — negligible against real worker
commands (compiles, tests, installs all take ≥ 100 ms).

Memory: 10 parallel `tsrs --noEmit` type checks of this repo (about 560 MB
peak RSS each), summed `maximum resident set size` from `/usr/bin/time -l`,
two rounds each on a 16 GB MacBook: unsandboxed 3 108 / 3 902 MB,
sandboxed 3 503 / 3 298 MB. The spread between rounds is larger than any
difference between the modes: Seatbelt adds no measurable memory.

Codex state mapping: `$CODEX_HOME` (default `~/.codex`) is writable, and
`config.toml`, `AGENTS.md` and `AGENTS.override.md` inside it are denied
for writes after the allow rule. Under that profile `codex login status`
passes and `codex exec --sandbox danger-full-access resume <id>` starts its
app-server and reaches the session lookup. A real `codex exec` turn and a
`codex exec … resume <id>` turn then ran under the same profile in a temp
repository: both wrote `hello.txt` through a shell command and exited 0.

Real `codex exec` inside the outer profile (inner `--sandbox
danger-full-access`, `~/.codex` writable) completed a turn successfully —
the app-server socket lives at the `~/.codex` root, so the whole directory
must be writable, not only `sessions/`.

Real-model e2e (`mise run test:dispatch` / `tsx scripts/e2e-dispatch.mts`):
a Pi worker dispatched on a temp project wrote `hello.txt`, reported,
landed, and woke the chief — all under Seatbelt. The `--swift` variant on a
real SwiftPM package also passed end to end; the worker ran `swift build
--disable-sandbox` per its instructions. Two default roots had to be added
for the toolchain: the per-user `C` cache dir (`$TMPDIR`'s sibling, clang
module cache) and `~/Library/org.swift.swiftpm`.

## 6. Observability

- A denied operation returns `Operation not permitted` (EPERM) in the tool output. Add one line to the Worker instructions in `AgentRuntime.create`: "Writes outside the working directory fail with 'Operation not permitted' by design. Do not retry with sudo or another path. Ask the chief if the task needs that path. Toolchains that sandbox themselves (SwiftPM, xcodebuild) must run with their own sandbox off, e.g. `swift build --disable-sandbox`."
- Record the sandbox mode, network mode, and profile path in the `run.dispatched` event payload, so a review shows whether a Run was sandboxed.
- For debugging: `log stream --style compact --predicate 'sender == "Sandbox"'` shows each denial with its path.

## 7. Implementation Checklist / TODO

### Phase 0: Spike and environment scrub

- [x] Scrub the Worker child environment (section 3.5). Test: a Worker `exec` of `env` shows no `TELEGRAM_*`, `WECHAT_*`, `MAGPIE_*`, or `TIAN_AGENT_*` names. Done: `agentShellEnv`.
- [x] Write the profile generator in `src/worker/sandbox.ts`, with path canonicalization and escaping. Unit-test the generated text.
- [x] Confirm rule precedence (a later `allow` overrides an earlier `deny`) with a macOS-only test.
- [x] Measure: spawn latency with and without `sandbox-exec` for 100 short commands, and total RSS for 10 parallel sandboxed builds compared with 10 unsandboxed builds. Record the numbers in this document.

### Phase 1: Opt-in per project

- [x] `SandboxedExecutionEnv`: `exec` rewrite for string and argv commands, path checks for file methods, scrubbed environment.
- [x] Env factory in `AgentRuntime.open`: sandbox only Worker conversations (`db.runByConversation`), and only when the project sets `sandboxMode = workspace-write`.
- [x] Resolve `<worktreeGitDir>` at `prepare` time with `git rev-parse --path-format=absolute --git-dir` in the worktree.
- [x] Project settings, schema, migration, dialog, and i18n (section 3.6).
- [x] Startup self-test and fail-closed Run start (section 3.7).
- [x] Worker instruction line and `run.dispatched` payload fields (section 6).
- [x] macOS-only integration tests (skip on other platforms):
  - [x] A write inside the worktree succeeds; a write to `rootPath` fails with EPERM.
  - [x] A write to `$TMPDIR` succeeds; a read of `<dataDir>/service.env` fails.
  - [x] An argv `exec` is sandboxed as well as a string `exec`.
  - [x] `writeFile` outside the roots returns a `FileError` from the in-process check.
  - [x] With `sandboxNetwork = off`, an external connection fails and a localhost connection succeeds.
  - [x] A connection to the service socket fails with either network setting.
  - [x] Stopping a Run kills the sandboxed process tree.
  - [x] `git status` works in the worktree; `git add` fails (objects land in the main `.git`, outside the write roots).

### Phase 2: Default on for new projects

- [x] New projects default to `sandboxMode = workspace-write`.
- [x] Run the manual `scripts/e2e-dispatch.mts` check with a real model on this repo and on one Swift or Xcode project. Update section 5 with the results.

### Phase 3: Default on for all projects

- [x] Migrate existing projects to `workspace-write`, and keep `off` as an explicit choice in project settings.
- [x] Update [architecture.md](architecture.md#permissions-and-scopes) (remove "they do not enforce operating system sandboxes"), PRD §13 question 8, and add a decision record to [decisions.md](decisions.md) (the next free number; D19 is the memory evidence decision). Mirror every change in `docs/zh/`.
