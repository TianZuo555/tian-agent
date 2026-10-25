# 工兵 OS 级沙箱：macOS Seatbelt（TODO 与实施方案）

[English](../todo-worker-sandbox.md) | **简体中文**

本文档跟踪把每条工兵命令放进 macOS Seatbelt 沙箱（`sandbox-exec`）的方案，回答 PRD §13 第 8 问（"工兵的写权限如何真正受限"）。

---

## 1. 问题

- 工兵拥有 `CodingTools`（bash、读、写、编辑），以当前 macOS 用户的全部权限运行。
- "只改当前目录"只是 prompt 里的指令（[architecture.md](architecture.md#权限与-scope)）；Git worktree 隔离的是分支，不是文件系统。
- 不可信文本能到达工兵：Telegram 与微信消息（有白名单）、项目内 `.tian/inbox` 文件、工兵读到的网页或文件。prompt injection 可以让工兵写 worktree 以外的路径、读取密钥或外发数据。
- 工兵与服务是同一个 macOS 用户，因此能连上服务 socket（权限 0600）并发送任意命令：批准 skill、land 或 ship Run、修改项目设置。
- 阶段 0 之前，每条工兵 shell 命令都继承服务的完整环境变量。服务把 `service.env` 载入 `process.env`（`src/service/entry.ts`），Pi 的 `NodeExecutionEnv` 再把 `process.env` 传给每个子进程，所以工兵命令能读到 `TELEGRAM_BOT_TOKEN`、`MAGPIE_API_KEY` 与微信配置。阶段 0 已去掉这些变量（`src/worker/agents.ts` 的 `agentShellEnv`）。

## 2. 为什么选 Seatbelt，以及内存开销

Seatbelt 是 macOS 内核沙箱。`sandbox-exec` 先给自身进程套上规则，再 `exec` 目标命令：PID 不变，不多起进程，子进程自动继承规则，没有虚拟机。

| 方案                                     | 机制                    | 每个工兵的额外内存 | 结论                                           |
| ---------------------------------------- | ----------------------- | ------------------ | ---------------------------------------------- |
| Seatbelt（`sandbox-exec`）               | 内核对进程施加规则      | 约为零             | **采用**                                       |
| 容器（Docker、Apple container）          | macOS 上需 Linux 虚拟机 | 数百 MB 起         | 否决：耗内存，且 Linux 里跑不了 macOS 工具链   |
| macOS 虚拟机（Virtualization.framework） | 完整客户机系统          | 数 GB              | 否决：耗内存，且每台主机最多 2 个 macOS 客户机 |

2026-10-25 实测：常驻服务 RSS 约 30 MB（16 个会话）；Magpie 约 318 MB，其 plugin host 约 348 MB，由所有工兵共用。工兵是服务进程里的一个 Pi 会话，不是独立进程。同时开 8–10 个工兵时，内存压力来自它们跑的命令（`pnpm install`、`tsc`、构建、测试、dev server），Seatbelt 不改变这部分开销。控制内存靠全局 attempt 上限（`src/worker/runs.ts` 的 `MAX_ACTIVE_ATTEMPTS`），不靠沙箱。

先例：Bazel 在 macOS 上用 `sandbox-exec` 并发执行大量构建动作，规则写法与第 4 节相同；Codex CLI 与 Claude Code 在 macOS 上也用 Seatbelt。

## 3. 设计

### 3.1 接入点

- `AgentRuntime.open` 通过 Harness 的 `env` 工厂为每个会话构建执行环境（`src/worker/agents.ts`），工厂每次调用都拿到 `{ conversationId, cwd }`。
- 工厂用 `db.runByConversation(conversationId)` 判断：只有工兵会话套沙箱；总管与项目管理者没有 shell 工具，继续用普通 `NodeExecutionEnv`。
- 新模块 `src/worker/sandbox.ts` 提供 `SandboxedExecutionEnv`，实现 Pi 的 `ExecutionEnv`，内部委托给 `NodeExecutionEnv`。

### 3.2 命令（`exec`）

`NodeExecutionEnv.exec` 接受两种形态：字符串走 shell（`<shell> -c <command>`），argv 数组直接 spawn 程序、不经过 shell。只靠 `shellPath` 包装脚本覆盖不到 argv 调用，所以 `SandboxedExecutionEnv.exec` 把两种形态都改写成 argv：

- 字符串：`['/usr/bin/sandbox-exec', '-f', profile, '/bin/bash', '-c', command]`
- 数组：`['/usr/bin/sandbox-exec', '-f', profile, ...argv]`

同时传 `inheritEnv: false` 和清洗过的环境变量（3.5 节）。中止仍然有效：Pi 以独立进程组 spawn 并杀整棵进程树，而 `sandbox-exec` 不改变 PID。

### 3.3 文件工具（进程内）

Pi 的读、写、编辑工具在服务进程内调用 `ExecutionEnv` 的文件方法，Seatbelt 看不到这些操作，因此 `SandboxedExecutionEnv` 自己检查路径：

- 写方法（`writeFile`、`appendFile`、`truncateFile`、`renameFile`（两端路径）、`createDir`、`remove`）：用 `canonicalPath` 解析（跟随符号链接；新文件解析其父目录），只允许第 4 节的可写根目录。
- 读方法（`readTextFile`、`readTextLines`、`openTextLineReader`、`readBinaryFile`、`openBinaryReader`、`listDir`、`openDirReader`、`fileInfo`、`exists`）：拒绝第 4 节的禁读路径。
- 拒绝时返回带明确说明的 `FileError`，不抛异常。

### 3.4 规则文件

服务为每个 Run 生成一份规则文件 `<dataDir>/sandbox/<runId>.sb`，路径全部规范化为绝对路径，并转义其中的 `\` 与 `"`。文件保留，便于审计与排查；工兵读不到它，因为 `<dataDir>` 属于禁读路径。

### 3.5 环境变量

子进程环境 = `process.env` 去掉 `TELEGRAM_*`、`WECHAT_*`、`MAGPIE_*`、`TIAN_AGENT_*`；项目设置可追加要去掉的变量名。这一步不依赖 Seatbelt，最先上线（阶段 0）。

### 3.6 项目设置

| 设置                | 取值                               | 默认（阶段 1 → 阶段 3）   |
| ------------------- | ---------------------------------- | ------------------------- |
| `sandboxMode`       | `off` / `workspace-write`          | `off` → `workspace-write` |
| `sandboxNetwork`    | `on` / `off`（localhost 始终放行） | `on`                      |
| `sandboxExtraWrite` | 绝对路径，每行一个                 | 空                        |
| `sandboxAllowRead`  | 从禁读列表中移除的路径             | 空                        |

需要：`projects` 新列（经现有升级事务提升 `DATABASE_VERSION`）、`src/shared/contracts.ts` 的 `updateProject` patch schema、`src/shared/types.ts` 的 `ProjectSettings`、`ProjectSettingsDialog.tsx`，以及 `en.ts` / `zh.ts` 的 i18n key。

### 3.7 失败即拒绝（fail closed）

服务启动时自检：`sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`。如果 `/usr/bin/sandbox-exec` 不存在或自检失败，`sandboxMode = workspace-write` 的项目拒绝启动 Run 并给出明确错误，绝不静默退回无沙箱运行。`sandbox-exec` 的 man page 标注为 deprecated，但 macOS 仍然自带；自检用于发现将来被移除的情况。

## 4. 规则

写法沿用 Bazel：先默认放行，再禁止，再重新放行。后写的规则优先于先写的规则，阶段 0 必须用测试确认这一点。

```scheme
(version 1)
(allow default)

; 网络：仅当 sandboxNetwork = off 时加入。localhost 保持开放，供 dev server 与测试使用。
(deny network*)
(allow network* (local ip "localhost:*") (remote ip "localhost:*") (remote unix-socket))

; 服务 socket：任何模式下都关闭。它接受全部服务命令。
(deny network-outbound (remote unix-socket (path-literal "<socketPath>")))

; 密钥：禁止读写服务数据与凭据。
(deny file-read* file-write*
  (subpath "<dataDir>")                 ; service.env、tian.db、pi-session.sqlite、其他 Run 的 worktree
  (subpath "<home>/.ssh")
  (subpath "<home>/.aws")
  (subpath "<home>/.gnupg")
  (subpath "<home>/.config/gh")
  (subpath "<home>/.docker")
  (subpath "<home>/.kube")
  (subpath "<home>/Library/Keychains")
  (literal "<home>/.netrc")
  (literal "<home>/.npmrc"))

; 写入：全部禁止，再放行本 Run 的根目录。
(deny file-write*)
(allow file-write*
  (subpath "<workRoot>")                ; worktree；in-place Run 为 rootPath
  (subpath "<worktreeGitDir>")          ; <repo>/.git/worktrees/<runId>：index 与锁文件
  (subpath "<tmpDir>")                  ; 规范化后的 $TMPDIR（/private/var/folders/...）
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
  ; 以及 sandboxExtraWrite 中的每个路径
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty")
  (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))

; 工作根目录位于 <dataDir>/worktrees 下：在密钥规则之后重新放行读取。
(allow file-read* (subpath "<workRoot>") (subpath "<worktreeGitDir>"))
```

对 worktree Run 的效果：

- 主 checkout（`rootPath`）可读不可写，所以 `memory/MEMORY.md` 与 `notes/` 只读，与工兵指令一致。
- 工兵读不到其他 Run 的 worktree、服务数据库和 token。
- 工兵连不上服务 socket。
- `git status`、`git diff` 正常；`git add`、`git stash` 失败，因为 `<repo>/.git/objects` 不可写。提交由应用代劳（`commitAll` 在服务进程中运行，不在沙箱内）。

## 5. 待验证的已知不兼容

- **嵌套沙箱**：已在沙箱中的进程不能再套一层 Seatbelt。SwiftPM 用 `sandbox-exec` 解析 `Package.swift`，所以 `swift build` 可能需要 `--disable-sandbox`；`xcodebuild` 同样需要检查。
- **基于 Chromium 的工具**（Electron、Playwright、Puppeteer）会启动自己的沙箱，在 Seatbelt 内可能需要 `--no-sandbox`。本仓库的 `pnpm test:runtime` 与 `pnpm test:app-upgrade` 都会启动 Electron。
- **写到根目录以外的工具**：全局安装（`npm i -g`、`brew`）、装到自定义路径的 `mise install`、使用自定义缓存路径的 language server。解决办法是 `sandboxExtraWrite`，而不是放宽默认规则。
- **私有 registry**：`~/.npmrc` 可能含 token，默认禁读；需要它的项目用 `sandboxAllowRead` 放行。

## 6. 可观测性

- 被拒的操作会在工具输出里报 `Operation not permitted`（EPERM）。在 `AgentRuntime.create` 的工兵指令里加一句："Writes outside the working directory fail with 'Operation not permitted' by design. Do not retry with sudo or another path. Ask the chief if the task needs that path."
- 在 `run.dispatched` 事件 payload 中记录沙箱模式、网络模式与规则文件路径，审查时能看出该 Run 是否在沙箱内运行。
- 排查时用 `log stream --style compact --predicate 'sender == "Sandbox"'` 查看每次拒绝及其路径。

## 7. 实施清单 / TODO

### 阶段 0：验证与环境变量清洗

- [x] 清洗工兵子进程环境（3.5 节）。测试：工兵 `exec` 执行 `env`，输出中没有 `TELEGRAM_*`、`WECHAT_*`、`MAGPIE_*`、`TIAN_AGENT_*`。已完成：`agentShellEnv`。
- [ ] 在 `src/worker/sandbox.ts` 实现规则生成（路径规范化与转义），对生成文本做单元测试。
- [ ] 用仅限 macOS 的测试确认规则优先级（后写的 `allow` 覆盖先写的 `deny`）。
- [ ] 测量：100 条短命令在有无 `sandbox-exec` 时的启动延迟；10 个并行沙箱构建与 10 个无沙箱构建的总 RSS。把数据记入本文档。

### 阶段 1：按项目手动开启

- [ ] `SandboxedExecutionEnv`：字符串与 argv 命令的 `exec` 改写、文件方法的路径检查、清洗后的环境变量。
- [ ] `AgentRuntime.open` 的 env 工厂：只给工兵会话（`db.runByConversation`）且项目设置为 `sandboxMode = workspace-write` 时套沙箱。
- [ ] 在 `prepare` 阶段于 worktree 内用 `git rev-parse --path-format=absolute --git-dir` 解析 `<worktreeGitDir>`。
- [ ] 项目设置、schema、迁移、设置对话框与 i18n（3.6 节）。
- [ ] 启动自检与 fail-closed 的 Run 启动（3.7 节）。
- [ ] 工兵指令新增的一句与 `run.dispatched` payload 字段（第 6 节）。
- [ ] 仅限 macOS 的集成测试（其他平台跳过）：
  - [ ] worktree 内写入成功；写 `rootPath` 返回 EPERM。
  - [ ] 写 `$TMPDIR` 成功；读 `<dataDir>/service.env` 失败。
  - [ ] argv `exec` 与字符串 `exec` 一样受沙箱约束。
  - [ ] 根目录以外的 `writeFile` 被进程内检查拒绝，返回 `FileError`。
  - [ ] `sandboxNetwork = off` 时，外部连接失败、localhost 连接成功。
  - [ ] 无论网络设置如何，连接服务 socket 都失败。
  - [ ] 停止 Run 时能杀掉沙箱内的整棵进程树。
  - [ ] worktree 内 `git status` 正常；`git add` 失败。

### 阶段 2：新项目默认开启

- [ ] 新项目默认 `sandboxMode = workspace-write`。
- [ ] 用真实模型在本仓库和一个 Swift / Xcode 项目上跑一遍 `scripts/e2e-dispatch.mts` 手动检查，把结果更新到第 5 节。

### 阶段 3：所有项目默认开启

- [ ] 把现有项目迁移为 `workspace-write`，并在项目设置中保留 `off` 作为显式选项。
- [ ] 更新 [architecture.md](architecture.md#权限与-scope)（删掉"不提供操作系统文件访问沙箱"）、PRD §13 第 8 问，并在 [decisions.md](decisions.md) 新增决策 D19。所有改动同步到英文文档。
