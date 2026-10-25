# Agent Browser and Computer Use (TODO & Roadmap)

**English** | [简体中文](zh/todo-computer-use.md)

This document turns the recommendations of the [Rakazo research](research/rakazo-review.md) into tracked work. The research holds the analysis and the reasons. This document holds the order, the scope of each stage, and the checklist.

---

## 1. Goal

Give the Chief and the Managers a computer that they can see and operate, without a container stack. Tian Agent is a single-user desktop app, and the computer is the machine the user sits at. A hidden Electron `BrowserWindow` gives the observation and action ability that Rakazo gets from Docker, X displays, and noVNC.

Worker isolation is a separate decision. See [todo-worker-sandbox.md](todo-worker-sandbox.md). Do not bundle it into this work.

## 2. Order

| Stage          | Scope                                                        | Start condition                          |
| -------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Small items    | Artifact attachments, lateness context, Chief activity feed  | Now; independent of the browser stages   |
| Run taint rule | Outside text taints a run; tainted runs need approval to act | Now; required before L1                  |
| L0             | Read-only browser tools for the Chief and Managers           | Now                                      |
| L1             | Controlled browser, user takeover, credential cards          | L0 shows real use, and a security review |
| L2             | Docker desktop sandbox                                       | Skip; revisit only on the trigger in §7  |

## 3. Small Items (independent of the browser)

- [ ] **Artifact attachments.** Agents attach images and files to a message, and the Chat view renders them. Today a Worker writes `TIAN_REPORT.md` and the user never sees an image that an agent made. Decide the storage location and the message entry shape before coding.
- [ ] **Lateness context for scheduled wakes.** When a Schedule wake starts more than 15 minutes after its occurrence, the wake notification states the scheduled time and the actual time in the Schedule's timezone. `src/worker/scheduler.ts` has no such rule today.
- [ ] **Chief activity feed.** `run_progress` shows recent output and tool calls for Workers only. Record the Chief's and the Managers' tool calls in the same event shape, so the user can see what they did.

## 4. Run Taint Rule

Rakazo splits tools into two groups: tools whose results are the product's own state, and tools whose results carry outside text. A result from the second group taints the run. After that, actions with destinations or arguments that the user did not give need approval, because injected text could now choose them.

- [ ] List the taint sources in Tian Agent: inbox messages, Telegram and WeChat input from someone other than Tian, Run reports and diffs, notes and files that the agent did not write, and (from L0) web pages.
- [ ] List the gated actions: dispatch to a Worker, `send_run_msg`, Manager delegation, and (from L0) navigation to a site that the user did not name.
- [ ] Build on the approval work (PRD scenario F, branch `m3-approvals`). Record the taint state per turn, next to the existing provenance (`src/worker/provenance.ts`).
- [ ] Tests: a tainted turn cannot dispatch without approval; an untainted user turn can.

## 5. L0: Read-Only Browser

- [ ] A hidden `BrowserWindow` in the Electron main process with its own session partition (`persist:agent`). Never the user's profile or cookies.
- [ ] `browse(url)`: load the page, wait for idle, return the title, extracted text, and a bounded list of interactive elements with refs (`e1`, `e2`, …). `snapshot()` returns the same structure without navigation.
- [ ] Screenshots through `webContents.capturePage()`. Send image bytes only when the model's catalog entry has `image` in its input modalities (`src/worker/magpie.ts` already parses `modalities.input`).
- [ ] One new Pi extension with the two tools, for the Chief and the Managers. Workers do not get it in this stage.
- [ ] Network rules: public web only by default, plus a domain allowlist in Settings. After DNS resolution, refuse private, loopback, link-local, and metadata addresses, and check every redirect hop. Verify the rules at start and fail closed.
- [ ] Limits: maximum page size, maximum element count, hard timeout. Reject stale refs; never retarget them.
- [ ] The IPC contract lives in `src/shared/contracts.ts`. The resident service stays the only state owner; the browser is a tool endpoint, not a second writer.
- [ ] Tests: allowlist and private-address refusal, redirect checks, limits, stale-ref rejection, tool availability when the desktop app is closed (see §8, question 1).

## 6. L1: Controlled Browser and Takeover

Start only after L0 shows real use and after a security review.

- [ ] `act(click | fill | type | upload)` by element ref, and `request_takeover()` for passwords, 2FA, CAPTCHA, or judgment.
- [ ] Show the agent's browser in the Context Pane with `WebContentsView`, so the user can watch and interrupt.
- [ ] Single-holder lease: the agent or the user controls the page, never both. Release on run end, on timeout, and on window close.
- [ ] Credential cards: the user types the secret in the app, the service stores it, and the agent fills it only into a field of the saved origin. The value never enters the model context or the transcript.
- [ ] The run taint rule (§4) gates outbound destinations.

## 7. L2: Docker Desktop Sandbox (skip)

No Docker supervisor, X displays, noVNC, per-bot Chrome profiles, or multi-provider sandbox layer. **Trigger to revisit:** Tian Agent becomes multi-user, or gains the remote server mode from the README roadmap. Record this as a decision with that trigger when the time comes.

GUI apps outside the browser: evaluate the `cua-driver` CLI (accessibility tree and window geometry on macOS) as a tool endpoint before any desktop image.

## 8. Open Questions

1. **Availability without the desktop app.** The resident service runs under launchd without the Electron app (D3, D9). A `BrowserWindow` exists only in the Electron main process. Decide: tools are unavailable when the app is closed, the service starts a headless Electron helper, or another runtime hosts the browser.
2. **Vision model.** Magpie must expose at least one model with `image` input. Without one, L0 is DOM text only. Check the live catalog before planning screenshots.
3. **Chief permissions.** The Chief has no shell or file-write tools by design. A browser with any logged-in state changes that. Decide before L1 whether the agent browser may ever share the user's cookies.
4. **Ownership.** Browser tools in the Chief extension (`src/worker/tools.ts`), or one shared extension for the Chief and the Managers, as `CodingTools` is shared. The shared form keeps one implementation.
