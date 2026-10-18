# Tian Agent

基于 Pi 的个人助理（大内总管）。长期目标是完整桌面应用，结合云端常驻能力与本机工具；第一阶段目标为可日常使用的 macOS 私人测试版。

本文件记录当前技术选型、feature 模型和实现范围。项目目前只有规划文档，尚未搭建应用代码。

## 产品模型

一个总管 + 若干 scope + 一支无头工兵 fleet。

- **总管**：唯一的 agent，Pi Durable 驱动，住在聊天里。它记得你是谁、各项目发生了什么，负责收信、派发、验收、汇报。
- **Scope**：`General` + 手动注册的 project。project = `{id, name, rootPath, settings}`。每个会话固定绑定一个 scope，侧边栏按 scope 分组。总管的工具都能带 scope 参数跨 scope 查询。
- **工兵**：蹲在 git worktree 里干活的无头 coding agent（v1 只接 Pi）。总管 dispatch 派活，跑完收报告+diff，用户验收后落地。

分工原则：**总管是指挥官不是工兵**。总管没有通用 shell，要动代码的活一律 dispatch，保证"派发→验收"回路不被腐蚀。

## 数据对象

| 对象   | 形态                                    | 写手         | 位置                                       | 粒度                             |
| ------ | --------------------------------------- | ------------ | ------------------------------------------ | -------------------------------- |
| Memory | OptMem 格式：`LOG.txt` + `TREE/` 摘要树 | **只有总管** | `rootPath/memory/`；global 在 app 数据目录 | 一行一事实，≤280B                |
| Notes  | markdown 文档                           | 用户+总管    | `rootPath/notes/`；global 在 app 数据目录  | 文档级                           |
| Tasks  | SQLite todo 行                          | 用户+总管    | Durable 库，带 scope 字段                  | `{title, status, due?}`          |
| Inbox  | `.tian/inbox/*.md`，一消息一文件        | 任何参与者   | 各 scope 目录                              | `{from, to?, body, ts, thread?}` |
| Runs   | 派发记录                                | app          | Durable 库                                 | 见下                             |

判据：memory 记"事实"（一句话），notes 存"内容"（文档），tasks 记"承诺"（要做的事），inbox 传"消息"（一次性），run 是"派发中的活"。

### 记忆流程

- 新会话自动 `wake`：全局记忆 + 当前 scope 记忆双挂载，由系统注入，不经 agent 选择。
- `note(target: "global"|"project")`：总管自己判断"这条是关于项目的还是关于这个人的"，默认写当前 scope。
- `recall`/`zoom`：正则逐字搜 + 摘要树下钻。
- 合并压缩（OptMem 的 nap 语义）由总管在会话内完成。
- UI 只读查看。**子 agent 永远不碰 memory**（它判断不了什么已知、什么重复）；记忆的唯一写手是总管。
- memory 是文本文件放在项目目录里：外部 coding agent 可读同一份记忆，共享基座免费获得。

### Dispatch 回路

```
dispatch(project, prompt) → worktree 里 spawn 无头 agent → 跑
→ 报告写 .tian/runs/<id>.md → 进程退出 → inbox 给总管丢消息
→ 自动唤起总管收信 → 写 memory + 更新 task + 汇报摘要
→ 用户看报告+diff → land / follow_up / discard / ship
```

```
Run = { id, project, agentKind, prompt, worktreePath, branch,
        status: queued|running|done|failed|interrupted,
        reportPath, exitCode, startedAt, finishedAt }
```

- **worktree 默认隔离**（`git worktree add`）：无头 agent 用无人值守模式自动接受编辑，爆炸半径限在 worktree 分支。非 git 目录退化为"只有报告没有 diff"。
- **报告契约**：app 在派发 prompt 后自动附加"做完把 ≤1 页报告写到 `.tian/runs/<id>.md`；不要碰 `memory/`"。子 agent 只读 `notes/`、`memory/` 取上下文。
- **完成通知**：进程退出 → run 标 done/failed → inbox 消息 → **app 自动唤起总管在对应 scope 会话里收信汇报**，不等用户开口。
- **超时**：每 run 有上限（per-project `runTimeoutMin`，默认 30）。app 退出时子进程跟着死，重启后孤儿 run 标 `interrupted`（Durable 存储兜住）。
- **review 动作**：`land`（worktree 分支合回，冲突标记给用户）、`follow_up`（同 worktree 续跑一轮）、`discard`（删 worktree）、`ship`（`gh pr create`）。land/discard 默认需用户确认；per-project `autoLand` 可免确认。

## 能力边界

- **总管包络（窄）**：scope 目录读写 + git 只读 + dispatch/inbox/task/memory/note 工具。无通用 shell。最大破坏面 = 写错一条 memory/note。
- **跨 scope 可见**：wake 只挂全局+当前两份，但 `list_runs`/`list_tasks`/`recall`/读 notes/inbox 都可指定任意 scope——"各项目进展如何"在 General 会话也能答。
- **跨 scope 写**：`note` 带 target，`send_msg` 带目标 scope。

## 技术栈

| 部分       | 选择                                 | 用途                                               |
| ---------- | ------------------------------------ | -------------------------------------------------- |
| 桌面框架   | Electron                             | 窗口、应用生命周期、系统集成                       |
| 工程模板   | Electron Forge + Vite + TypeScript   | 开发、构建和打包                                   |
| UI         | React + Tailwind CSS + shadcn/ui     | 设置、任务列表、结果卡片                           |
| 聊天组件   | assistant-ui                         | 消息、输入框、工具结果；通过自定义 runtime 对接 Pi |
| Agent 核心 | `@earendil-works/pi-durable`         | 会话、工具任务、状态持久化和中断恢复               |
| 模型接入   | `@earendil-works/pi-ai`              | 模型及 provider 接入                               |
| 记忆引擎   | OptMem `memo` 脚本（python3 子进程） | LOG/TREE 管理；开工先查 license，不行就 TS 重写    |
| 存储       | Pi Durable 自带 SQLite backend       | 会话、运行状态、tasks、runs                        |
| 本机执行   | 独立 Node worker                     | Pi Durable、工具、dispatch 子进程，与界面分开      |
| 第一版分发 | macOS 安装包，手动更新               | 私人测试使用                                       |

Electron 自带 Node 运行时。worker 的具体启动方式、依赖打包和 SQLite 兼容性，在第一天的工程验证中确定。

## 为什么选 Electron

比较过 Electron、Tauri 和 AppKit，按交付速度选择 Electron。

| 方案             | 优点                                                        | 不优先原因                                     |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Electron         | React UI 和 Pi 都能用 TypeScript；自带 Node；桌面工具链成熟 | 安装包和内存占用较大，首版接受                 |
| Tauri + React    | 复用 Web UI，系统 WebView，跨平台                           | Pi 仍需 Node sidecar，还要处理 Rust/Node 通信  |
| AppKit + SwiftUI | macOS 原生集成直接                                          | 需要 Swift/Node 桥接；聊天和复杂内容展示成本高 |

后续若原生 macOS 交互成为产品核心再评估 AppKit。

考虑过 fork stablyai/orca（MIT，Electron 系，自带 fleet+worktree+orchestration）。结论是**不 fork**：它的核心是实时终端/ADE 能力（PTY、状态检测、流式画面），而本设计只要"无头跑+收报告+看 diff"，那部分自建成本远低于消化 15k commit 的代码库。它的 agent 适配器和 orchestration 层可作参考实现。

## 第一版架构

- **Renderer**：React 界面。左栏 scope+会话，中间聊天，右栏 tabs（Tasks/Memory/Runs/Inbox），run 详情带 diff 视图，独立设置页。通过受控 IPC 发操作。
- **Main/preload**：窗口、生命周期、worker 管理、有限 IPC。Renderer 不直接执行 shell 或持有任意文件访问。
- **Node worker**：Pi Durable、模型调用、全部工具、dispatch 子进程、SQLite。
- **状态归属**：Durable 持久化状态是权威来源；前端状态仅展示。前端先从快照恢复再订阅更新。

### 生命周期

- 关闭窗口：应用驻留，worker 与 run 继续。
- 退出应用：worker 停止，run 子进程被杀；下次启动孤儿 run 标 `interrupted`，恢复可恢复的工作。
- 休眠/关机：本机无法持续执行。退出后独立后台服务不做。

## Pi Durable 与 Pi SDK 的边界

Pi Durable 与 `@earendil-works/pi-coding-agent` SDK 是不同运行框架。**第一版总管只用 Pi Durable + pi-ai**；读写笔记、搜索等直接实现为工具。

被 dispatch 的工兵是独立进程（`pi` headless/SDK 模式），它的内部持久化与总管的 Durable 恢复无关——对总管来说工兵只是"子进程 + 报告文件"。app 记录 run ID 与 worktree 路径，恢复策略 = 进程死了就标 interrupted，不尝试接管工兵内部状态。

## v1 范围

**留下**：

- 聊天、流式回复、按 scope 分组的会话列表。
- scope 体系 + 手动注册 project（含 per-project settings：`autoLand`/`agentKind`/`runTimeoutMin`/`baseBranch`/`promptPreamble`）。
- OptMem 记忆：wake 双挂载、note/recall/zoom、只读查看器。
- tasks：add/list/done 工具 + UI 面板。
- inbox：文件总线 + fs-watch + check_inbox/send_msg 工具。
- dispatch：Pi 无头、worktree 默认、run 生命周期、报告契约、超时与 interrupted。
- review：报告+diff stat+完整 diff 视图；land/follow_up/discard/ship；land 默认确认。
- run 完成等事件自动唤起总管汇报。
- 新会话开头自动汇报"你不在期间"（prompt 层面实现，免费）。
- 全局设置（模型、keychain 密钥）+ per-project 设置。
- macOS 打包。

**砍掉**：

- notes 专用 UI 面板（文件即真相，编辑器打开）。
- agent↔agent 专用入口（总线已支持，先观察）。
- Pi 以外 agentKind 适配（接口就是 `{cmd,args,cwd}`，后加便宜）。
- Devin 云端 session 派发（是 API 不是子进程，归云端阶段）。
- 系统推送/定时简报、云端常驻、跨设备、多 agent 编排、语音、向量库、自动更新。

## 交付计划（2–3 周）

| 阶段          | 验收结果                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------- |
| P1 工程验证   | Electron 启动；worker 内 Pi Durable 流式回复；SQLite 与打包依赖验证；memo 脚本 license/可用性确认 |
| P2 记忆骨架   | scope/项目注册；wake 双挂载；note/recall/zoom；只读查看器                                         |
| P3 会话与数据 | 聊天 UI、会话列表、tasks 工具+面板、inbox 文件总线+fs-watch                                       |
| P4 dispatch   | worktree 创建、无头 Pi spawn、run 生命周期、报告契约、超时/interrupted                            |
| P5 验收回路   | run 完成事件→自动唤起；diff 视图；land/follow_up/discard/ship+确认                                |
| P6 收尾       | 设置页+keychain、真实任务试用、macOS 打包                                                         |

以 agent 辅助开发为前提。对外分发时另行安排签名与公证。

## 实现时必须确认的边界

- **版本**：固定 Pi Durable 及相关依赖版本；升级前验证状态读取与任务恢复。
- **恢复**：中断的模型请求可能重新发起；工具是否重跑取决于 replay 策略。恢复不等于外部操作只执行一次。
- **外部操作**：land/ship/发消息等需要稳定操作 ID、执行记录和去重。
- **确认流程**：land/discard 等确认状态与结果入库，不只依赖前端弹窗。
- **存储**：一个 Pi storage 由一个进程持有；不让多个 worker 同时写同一份存储。run 子进程不碰总管 storage。
- **UI 状态**：先快照恢复再应用后续更新；前端聊天记录不是权威状态。
- **子进程**：dispatch 的工兵随 app 退出被杀是特性不是 bug；`interrupted` 是正常状态。

## 后续：云端 + 本机

长期保留混合部署：

| 部分       | 后续候选                                            |
| ---------- | --------------------------------------------------- |
| 云端服务   | Node.js LTS + Hono                                  |
| 主 Agent   | Pi Durable + pi-ai                                  |
| 云端持久化 | SQLite + 持久卷与备份                               |
| 部署       | 单台 VPS + Docker Compose                           |
| 客户端通信 | HTTPS + WebSocket                                   |
| 本机执行   | 桌面端 worker；工兵按需接更多 agentKind / Devin API |

云端保存权威任务状态，本机主动连接云端。设备身份、认证、历史迁移另行设计。

### Cloudflare 备选

Cloudflare 有 `agents/harness/pi` 集成（Durable Objects SQLite）。云端主要为 HTTP API 且想减服务器维护时可重估；当前选 VPS。

## 参考资料

- [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [OptMem](https://github.com/VictorTaelin/OptMem)
- [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [Orca](https://github.com/stablyai/orca)（参考实现，不 fork）
- [Electron Forge](https://www.electronforge.io/)
