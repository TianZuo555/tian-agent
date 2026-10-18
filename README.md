# Tian Agent

一个总管、按项目划分的 scope，以及在 worktree 中执行任务的无头工兵。总管与工兵之间有双向消息通道：工兵可以在执行中向总管提问并等待答复，总管也可以中途下达指令。总管运行在独立的本机常驻 Node 服务中；Electron App 是它的桌面客户端。

当前已实现聊天、项目注册、记忆、任务、Inbox、Run 派发与验收、总管与工兵的双向消息（agent-to-agent），以及多渠道独立 Session 的后端接口。

产品需求与路线图见 [docs/prd.md](docs/prd.md)，术语见 [CONTEXT.md](CONTEXT.md)，架构决策见 [docs/adr/](docs/adr/)。

## 开发与验证

工具链、任务和本地环境变量都由 [mise](https://mise.jdx.dev/) 声明在 `mise.toml`：Node 26 与 pnpm 12.5.1 固定在项目内，不再依赖全局 mise 配置。进入目录后 mise 自动切换版本。

```sh
mise install
mise run setup    # pnpm install + pnpm service:install
mise run start    # 启动 App
mise run verify   # typecheck + lint + react-doctor + test
mise run check    # typecheck + lint
mise run doctor   # 仅跑 react-doctor
```

`mise tasks ls` 列出全部任务（`start`、`check`、`doctor`、`verify`、`test`、`test:*`、`service:*`、`package`），每个任务都只是对 `package.json` 脚本的薄封装，因此 CI 和不使用 mise 的机器仍可直接 `pnpm <script>`。

### React 代码质量

[React Doctor](https://react.doctor) 以确定性规则扫描正确性、性能、可访问性、安全与可维护性，`mise run verify` 会执行它。规则与例外写在 `doctor.config.ts`：

- 扫描 `src/**`，跳过 `.vite/`、`dist/`、`out/` 构建产物。
- 关闭 `use-lazy-motion`：App 在 Electron 内从磁盘加载，把约 30 kB 的 motion 特性包延迟加载没有收益，反而会让首帧出现无动画的 UI。

新增诊断优先修根因；确属误报或有意为之，用单行 `// react-doctor-disable-next-line <rule>` 并写明原因，不要整条规则关掉。

### 本地环境变量

`mise.toml` 通过 `[env] _.file` 读取仓库根目录的 `.env`（已 gitignore，缺失也不报错，值标记为 redacted）。从模板开始：

```sh
cp .env.example .env
```

| 变量                                 | 作用                                                |
| ------------------------------------ | --------------------------------------------------- |
| `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` | 模型网关地址与密钥，默认 `http://127.0.0.1:3425/v1` |
| `TELEGRAM_BOT_TOKEN`                 | Telegram Bot token；为空时适配器不启动              |
| `TELEGRAM_ALLOWED_CHAT_IDS`          | 允许对话的 chat id，逗号分隔                        |
| `TIAN_AGENT_DATA_DIR`                | 数据目录；`mise run service:env` 也用它决定写到哪里 |
| `TIAN_AGENT_SOCKET_PATH`             | Unix socket 路径（绝对路径，不超过 100 字节）       |

`.env` 只影响 mise shell（App 与 `pnpm` 任务）。常驻服务由 launchd 启动，读不到 shell 环境，需要把 `MAGPIE_*` / `TELEGRAM_*` 写进 `<dataDir>/service.env`：

```sh
mise run service:env
mise run service:restart
```

该任务只导出 `MAGPIE_*` 与 `TELEGRAM_*`，跳过空值，原子写入且权限为 `0600`；其余开发变量不会进入服务环境。

- `pnpm test`：临时数据库、真实临时 Git 仓库和可控工兵；覆盖权限、记忆、Inbox、Run 状态、前端同步和多客户端服务。不调用模型。
- `pnpm test:runtime`：验证打包后的服务产物可以离开 checkout、通过普通 Node 运行，并连接 sandbox preload 和真实 renderer；退出 Electron 后服务继续运行。不使用用户数据或模型。
- `pnpm test:launchd`：安装独立测试 LaunchAgent，强制结束其进程，验证系统自动重启、持久化恢复和客户端重连，随后删除测试服务。
- `pnpm test:upgrade`：真实隔离 LaunchAgent，验证维护期间拒绝写入、启动失败回滚、数据库备份恢复、未完成升级恢复，以及停止服务与登录偏好的独立性。
- `pnpm test:app-upgrade`：构建两个版本的真实 macOS App，使用隐藏窗口及临时数据验证设置面板、断开／重连、App 启动失败回滚、App 与服务配套升级及界面启动确认。此命令暂时修改版本号并在结束时恢复，不要与其他打包命令同时运行。
- `scripts/e2e-dispatch.mts`：需要模型凭据的手工集成检查，会执行真实工兵任务。

## 本机常驻服务

开发构建要求 Node.js 24 或更新版本，`mise.toml` 固定为 Node 26。首次安装或更新后端时运行 `mise run service:install`（或 `pnpm service:install`），也可以在 App 设置的“服务与升级”中操作。安装器将完整构建产物和固定版本的 Node 运行时复制到独立 release，LaunchAgent 不依赖开发 checkout、系统 Node 安装、终端或 Electron 进程存活。

| 操作                 | 命令                                          |
| -------------------- | --------------------------------------------- |
| 安装／更新并启动     | `pnpm service:install`                        |
| 查看状态与 PID       | `pnpm service:status`                         |
| 启动／停止           | `pnpm service:start` / `pnpm service:stop`    |
| 重启                 | `pnpm service:restart`                        |
| 移除自启动，保留数据 | `pnpm service:uninstall`                      |
| 前台调试             | `pnpm build:service`，然后 `pnpm service:run` |

默认位置：

- 应用数据：`~/Library/Application Support/Tian Agent/`，复用已有数据库和 Memory。
- LaunchAgent：`~/Library/LaunchAgents/dev.tian.agent.plist`。
- 服务产物：`<dataDir>/service/releases/<hash>/`。
- 日志：`<dataDir>/service/logs/service.log`。
- 连接：`<dataDir>/agent.sock`，Unix socket 权限为 `0600`，数据目录为 `0700`。

使用 `TIAN_AGENT_DATA_DIR` 或 CLI 的 `--data-dir` 指定其他数据目录，`TIAN_AGENT_SOCKET_PATH` 可指定 socket 路径；App 与服务必须使用相同配置。存储和 socket 都有独占锁。旧版 App 仍占用数据库时，新服务会拒绝打开存储，需要先退出旧版 App。

LaunchAgent 使用 release 内的独立 Node 运行时，其 Node 就是构建时 `mise` 选中的版本。环境变量密钥通过 `mise run service:env` 写入 `<dataDir>/service.env`（`0600`）后重启服务；当前模型由 Magpie 网关提供，可在此配置 `MAGPIE_BASE_URL` 与 `MAGPIE_API_KEY`。安装器不将模型密钥写入 plist。

登录自启动、服务运行和 App 连接是独立状态。App 启动时只按偏好连接现有服务，不会把已经停止的服务自动启动。退出 App 仅关闭连接；明确“断开本窗口连接”会持久保存不自动重连的偏好。系统休眠或关机期间无法执行任务。

## 服务控制与升级

打包结构、安装位置和一次完整升级的示例，见 [ADR-0009：App 与服务的打包和升级](docs/adr/0009-app-service-packaging-and-upgrades.md)。

Settings 中的“服务与升级”在服务离线时也可访问，支持查看 App／配套服务／运行服务版本、连接、断开、启动、停止、登录自启动、安装配套服务和恢复未完成升级。停止或升级前检查 Durable tasks、queued submissions、Runs 和验收操作；仍有工作时拒绝操作，保留原服务运行。首次迁移没有版本信息的旧服务时，设置页会单独标识：旧版没有空闲检查，需确认工作可以暂停后先正常停止，再安装新版配套服务。数据保留；旧协议不再用于新版 App 的业务连接。

关闭登录自启动只移除 `~/Library/LaunchAgents/` 中的入口，保留安装目录中的定义，允许手动启动并在当前登录会话内崩溃重启。停止服务使用 `bootout`，避免 KeepAlive 立即将其启动。重新打开 App 不撤销停止操作。

服务升级执行以下事务：

1. 校验完整 release manifest，包括所有动态 chunk、平台、架构、协议、数据库版本与独立 Node；复制到不可变 release 目录。
2. 获取升级互斥锁，拒绝新请求并检查现有工作已空闲。
3. 写入持久化维护标记，停止旧服务，在存储锁保护下备份两份 SQLite 及存在的 WAL／SHM。
4. 切换服务定义并启动新版。新版在维护模式下启动，不恢复任务、不投递 Inbox、不接受普通请求。
5. 核对版本、release ID、数据库版本及维护状态；写入提交记录后才恢复工作。
6. 提交前失败则恢复数据库快照、旧服务定义和原运行状态。提交后不自动恢复旧数据库，避免覆盖新数据；恢复入口只继续完成激活。

升级日志位于 `<dataDir>/service/update.json`，维护标记在 `service/maintenance.json`，快照在 `service/backups/<transaction-id>/`。协调进程异常退出后，可通过设置中的恢复入口继续处理。已成功升级后保留当前与上一份服务 release，以及最近三份数据库备份。Memory 文本格式未改变，升级不替换其内容。

已打包的 macOS App 支持“导入新版 App…”：选择更高版本的 `.app`，检查应用标识、版本、配套服务及平台架构；当前 App 有开发者签名时，新版必须由同一开发者签名且通过签名验证。本地未签名开发版本需要在确认框中明确确认。App 所在目录必须可写。

确认后，独立升级进程等待旧 App 退出，在同一磁盘暂存并原子切换 App 目录。已有服务与 App 一起升级；未安装服务时只更新 App，已停止的服务升级后仍保持停止。新 App 必须完成 renderer 挂载及配套服务版本检查，升级器才提交并解除维护状态。检查失败会恢复旧 App 与服务。此功能支持当前协议及数据库版本；未来破坏性迁移需要同步扩展升级器，不能直接绕过兼容检查。

目前升级来源是用户选择的本地 `.app`；远端版本检查、下载源、发布签名和公证尚未配置。

## 渠道与独立 Session

所有入口共享一个后端及 scope 记忆。`openSession({channel, externalId, scopeId})` 为渠道会话查找或创建稳定的内部 conversation。不同渠道、外部会话或 scope 得到不同 conversation；绑定持久化，重启后仍可复用。

例如 App 与 Telegram 都绑定 `global`，拥有独立聊天上下文，但每次请求加载同一份全局 Memory。仅存在于聊天记录、没有沉淀为 Memory 的内容不会自动进入其他 Session。外部输入可以向 `submit` 提供稳定的 `requestId`，由 Durable 去重。

### Telegram

服务内置 Telegram Bot 适配器：Bot API long polling，无需公网入口。未配置 token 时适配器不启动，服务其余部分不受影响；网络故障按指数退避重试，不会阻塞服务。

在仓库 `.env` 中配置，再 `mise run service:env && mise run service:restart`（等价于写入 `<dataDir>/service.env`，权限 0600）：

```sh
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_CHAT_IDS=111111111,222222222
```

- 只有白名单中的 chat 可以触发对话，其余更新只记录 chat ID 并忽略。
- 每个 chat 维护一个当前 scope（默认 `global`）：`/scope` 查看，`/scope 项目名` 切换；切换后同一 chat 的消息进入该 scope 的独立 conversation，选择持久化，重启后保持。`/status` 显示当前 scope 的待办任务与运行中的 Run；`/help` 列出命令，未知命令同样返回帮助。
- 收到的消息以 `tg:<chatId>:<message_id>` 为稳定 `requestId` 提交，同一更新重复投递不会重复提交；`getUpdates` offset 持久化，重启不会重放已处理的更新。
- 所在会话的总管回复（直接回复与主动汇报）以纯文本发回 chat：按行边界拆分为不超过 4096 字符的消息；转发游标持久化，重启既不重发也不漏发；流式片段、工具调用与思考内容不转发。
- 审批等受控操作尚未接入 Telegram，适配器的命令入口与推送通道为后续接入预留。

## 进程与模块

- **Renderer**：React + Tailwind + coss，维护展示状态与订阅，拒绝过时响应。聊天使用应用自己的 `ChatSnapshot`。
- **Preload**：通过 `contextBridge` 暴露共享类型的命令和可取消订阅；保持 sandbox、context isolation，关闭 Node integration。
- **Main**：管理窗口、目录选择和 IPC 转发，通过 Unix socket 连接常驻服务；不打开数据库。
- **常驻服务**：唯一持有应用数据库和 Pi storage，执行模型、工具、Inbox、通知和 Run。客户端重连后重新获取快照及订阅。

| 模块                           | 职责                                              |
| ------------------------------ | ------------------------------------------------- |
| `service/server.ts`            | 服务生命周期、独占锁、Unix socket RPC、客户端隔离 |
| `service/client.ts`            | 请求、事件、自动重连；关闭客户端不停止服务        |
| `service/launchd.ts`           | 服务升级事务、备份、回滚、恢复与 LaunchAgent 管理 |
| `desktop/controller.ts`        | App 连接偏好、服务控制及本地升级入口              |
| `desktop/app-update.ts`        | App 校验、独立替换、启动检查与失败恢复            |
| `shared/contracts.ts`          | IPC / socket 参数 schema、返回类型和消息合约      |
| `shared/messages.ts`           | Pi transcript 转换为聊天快照                      |
| `worker/service.ts`            | 应用组装、项目、总管会话、渠道绑定、Inbox 与通知  |
| `worker/commands.ts`           | 各 transport 共用的业务命令                       |
| `worker/agents.ts`             | Pi API 适配和总管／工兵能力配置                   |
| `worker/worker-tools.ts`       | 工兵消息工具：ask_chief、tell_chief、check_msgs   |
| `worker/runs.ts`               | Run 状态、attempt、收集、恢复及验收               |
| `worker/data.ts`               | task、memory、Inbox 操作和更新事件                |
| `worker/db.ts`                 | 业务数据、渠道绑定、通知 outbox、幂等记录         |
| `worker/scopes.ts`             | scope 目录、notes 和 Inbox 文件导入               |
| `worker/memory.ts`             | SQLite 记忆、来源与版本、摘要树                   |
| `worker/events.ts`             | 业务事件与审计日志（`events` 表）                 |
| `worker/improvements.ts`       | 改进日志、系统异常指纹去重、提升为 Task           |
| `worker/tools-improvements.ts` | 总管工具：log_improvement、list_improvements      |
| `worker/history.ts`            | transcript 与事件的派生全文索引、增量同步与检索   |
| `worker/tools-history.ts`      | 总管检索工具：search_history、read_history        |
| `worker/dispatch.ts`           | worktree、commit、diff、merge 和 PR 命令          |
| `worker/telegram.ts`           | Telegram Bot 长轮询、白名单、会话映射与回复转发   |

总管和工兵共用常驻服务内的 Harness 与 Pi storage，各自显式选择 extension。工兵当前是 Durable 会话，生命周期与桌面客户端独立。

## 权限与 scope

总管只启用 chief extension：task、memory、notes、Inbox、改进日志、dispatch 和 Run 查询，以及 Run 消息（`send_run_msg` / `list_run_msgs`），没有 `bash/read/write/edit`。读取结果使用 `read_run_report` / `read_run_diff`。启动时也会重新限制已有总管会话的 extension。

工兵启用 CodingTools 加消息 extension，默认在 Git worktree 中工作，没有总管的 memory 写入工具。工兵可在执行中用 `ask_chief` 向总管提问并阻塞等待答复，用 `tell_chief` 发送进度通知，用 `check_msgs` 接收总管指令；问题通过通知管道唤醒总管，答复与指令落在按 run 持久化的消息线程（`agent_messages` 表）里，重启不丢。指令要求仅编辑当前目录、只读共享 memory/notes；worktree 提供 Git 目录隔离，当前不提供操作系统文件访问沙箱。

Scope 分为 `global` 和手动注册的项目。会话绑定 scope，总管可通过工具跨 scope 查询。项目设置包含 `autoLand`、`allowInPlace`、`runTimeoutMin`、`baseBranch`、`promptPreamble`；当前工兵类型为 `durable-worker`。

## Memory

记忆存储在 SQLite（`tian.db`，由常驻服务独占写入），带来源、可信度与版本；文件只是单向只读导出（ADR 0004）：

```text
<scope root>/memory/
  MEMORY.md        每次写入后原子重写的只读视图（有效记忆 + 未失效摘要）
  legacy/          一次性导入后的旧 LOG.txt 与 TREE/
```

表结构（`src/worker/memory.ts`）：

- `memories`：每条记忆带 `seq`（Scope 内不可变序号，也是摘要树叶位置）、`kind`、`source_type`/`source_ref`、`trust_level`/`confidence`、`status`（active/superseded/deleted）。正文单行，最多 280 UTF-8 字节。
- `memory_versions`：追加式版本记录（create/supersede/delete/import，含操作者、原因与前后内容），支持审计与恢复。
- `memory_nodes`：对齐二叉摘要树（`(scope, lo, hi)`）；记忆被取代或删除时，覆盖它的节点标记 stale，Core Memory 下探到子节点或原始行，并重新排入压缩队列。
- `memory_fts`：FTS5 trigram 全文索引（中文可检索；少于 3 字符的查询回退为 LIKE 子串匹配），默认只查有效记忆，`include_history` 查历史。

Chief 工具：

- `remember`：新增记忆；`source: "user"` 表示 Tian 明确陈述（trust = user_confirmed），可选关联 goal。
- `revise`：取代旧记忆（新 `seq`，旧记忆保留为历史并指向新记忆）；用户纠正一律 revise，不追加矛盾行。
- `forget`：标记删除，从不物理删除。
- `recall` / `nap` / `zoom`：检索、压缩与下钻；对齐区间、双子节点、并发 nap 不覆盖非 stale 节点等规则不变。零有效记忆的待合并区间自动写入空标记节点，不需要模型调用。

Core Memory（`wake`）按 Token 预算渲染：默认每 Scope 1500 tokens，按 `ceil(UTF-8 字节 / 3)` 估算，超出时头尾省略并提示 recall/zoom。同一 Conversation 内使用稳定快照：只在新的用户轮次开始且记忆版本变化时刷新，避免 Prompt 前缀缓存失效；轮次内的写入通过工具返回值告知模型。

首次打开某 Scope 时，若存在旧版 `LOG.txt` / `TREE/`，一次性事务导入（seq = 行号，来源标记 legacy、可信度 agent_inferred）并移入 `memory/legacy/`；之后数据库是唯一写入来源，`MEMORY.md` 永远只读，供 Worker 与人直接阅读。

项目记忆位于 `<project root>/memory/`；全局记忆位于 `<dataDir>/scopes/global/memory/`。较长内容存入 `<scope root>/notes/` 的 Markdown 文档。UI 中用户可直接修订或删除记忆（`memoryRevise` / `memoryForget`，操作者为 user），全部历史保留在版本记录中。

记什么、如何摘要由总管模型负责。当前没有向量索引、语义去重或独立后台压缩服务。

## 改进日志

Log 视图和 `improvements` 表记录值得改进的产品问题、使用摩擦、想法与成功经验，与审计 Event、Memory 分开（[ADR 0010](docs/adr/0010-improvement-log.md)）：

- 一条条目带 `kind`（issue / friction / idea / win）、`status`（open / promoted / resolved / dismissed）、severity、来源（user / chief / system）和 Scope；可选关联 Run、Conversation、Event。列表只取摘要，展开时才读取 detail。
- 总管用 `log_improvement` 写入，用户可在 Log 视图新建；`list_improvements` 用于避免重复记录。
- 服务启动、监听、Inbox、History、通知、调度、Run、Land/Ship、Telegram 与渲染层的异常会通过同一个 `reportIssue` 汇点自动记录。相同 `area + error name + code + message` 在同一个 Scope 的 open/promoted 条目上合并为一条并累计 `occurrences`；正文会脱敏 bot token、Bearer、`sk-*` 和常见密钥赋值。
- Promote 会在同一事务中创建一条带 `improvement:<id>` 去重键的待办 Task，并回写 `task_id`；重复操作复用同一条 Task。
- 自动捕获是 best-effort，写入失败只回到 `console.error`，不阻塞原业务。原始进程输出仍写入 `service.log`。
- 新增 Log 命令与 `improvements` 事件后，`SERVICE_PROTOCOL` 为 3。

## Run 生命周期

```text
dispatch → queued → running → collecting → done / failed
                            ↘ discard → interrupted
```

执行与验收状态分别记录。验收状态包括 `pending / landing / landed / shipping / shipped / discarding / discarded`。

- Git 项目必须成功创建 worktree；隔离失败终止派发并保留记录。
- 非 Git 项目默认拒绝，明确开启 `allowInPlace` 后才可修改原目录。
- Run 保存派发时的目录、base branch、执行模式及截止时间。
- follow-up 每轮有独立 attempt、输入、结果和报告，复用工兵会话与 worktree。
- 派发用稳定操作 ID，各轮输入用稳定 `requestId`。
- 成功依据 Durable submission 结果；空闲不代表成功，Git 提交失败会进入失败状态。
- 同一 Run 的状态转换与验收串行。discard 先停止工兵，collector 不覆盖其结果。
- land 合入保存的 base branch，要求主 checkout 位于该分支且无已跟踪文件的未提交修改；land 后不能 follow-up。
- ship 推送分支，再查询或创建 PR，重复请求复用 PR URL。
- 已开始的 land/ship/discard 先入库，启动时继续或核对。

## Agent 消息（总管 ⇄ 工兵）

每个 Run 有一条持久消息线程（`agent_messages` 表），双向可达：

- 工兵 `ask_chief(question, wait_seconds?)`：提问并阻塞等待答复。问题经通知管道立即唤醒总管（不等待 Run 结束），总管用 `send_run_msg` 回复；等待窗口内无答复则指示工兵自行判断并在报告中记录。Run 被 discard 时提问立即返回并要求停止。
- 工兵 `tell_chief(text)`：发送不等待的进度通知。
- 工兵 `check_msgs`：读取总管发来的木读消息（答复之外的主动指令）。
- 总管 `send_run_msg(run, body)`：回复提问中的工兵，或对运行中的 Run 主动下达指令；`list_run_msgs(run)` 查看完整线程。

消息 ID 与通知 ID 均由调用派生，Durable 重放不产生重复消息；已读状态持久化。工兵被指示优先自行决策，只在破坏性操作、缺失凭据或根本性歧义时提问。

报告从 `TIAN_REPORT.md` 收集到 `<project root>/.tian/runs/`，每轮独立保留，报告不进入代码提交。

## Goals 与调度

用户管理目标，Agent 管理任务。Goal 是长期跟进的结果（objective、success criteria、constraints、current state、next action、last execution、每日预算），存于 `goals` 表；总管用 `create_goal` / `update_goal` / `list_goals` 维护它们，用户在 Goals 视图创建、编辑、暂停、恢复或取消。

- **Goal 会话**：每个 Goal 通过渠道绑定 `openSession({ channel: 'goal', externalId: goalId, scopeId })` 获得一条专属总管会话，跨重启稳定，唤醒内容只投递到这条会话。
- **Task 状态机**：待办即 Task。状态 `pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`，转换集中在 `db.ts` 一处校验，非法转换抛错；结果单独记 `outcome`（achieved / not_achieved / no_change）与 summary。`trigger`（manual / schedule / event）与唯一 `dedupe_key` 记录来源，重启或重复触发不会生成第二个 Task。
- **调度器**：`schedules` 表保存 cron、时区与持久化的 `next_fire_at`；服务内定时器睡到最早的触发点（上限 60 秒，不阻塞退出）。每次触发在一个事务内完成：创建 Task（`dedupe_key = sched:<schedule>:<触发时间>`）、向 Goal 会话投递通知（内容只含 Goal 状态与本次 Task，不重建历史）、并从当下推进 `next_fire_at`——停机期间错过的触发合并为一次，不补跑。
- **预算**：每个 Goal 的 `max_runs_per_day` 限制每日执行次数；超出后本次唤醒生成 `blocked` Task 并给用户留下去重提醒，而不是默默丢弃。
- **用户提醒**：`notify_user(goal, fingerprint, text)` 把要用户知道或决定的事写入 `user_notices`；同一 Goal 相同 fingerprint 在 24 小时窗口内只送达一次，`outcome = no_change` 的结果不应通知。Goals 视图展示提醒列表；Telegram 投递留待后续。
- **代码类任务**：`dispatch` 工具接受可选 `task` 参数，`runs.task_id` 记录 Run 与 Task 的关联；Run 完成不等于 Task 完成，由总管依据结果调用 `complete_task` / `fail_task` 收口，再 `update_goal` 写回状态。

## 持久化、恢复与通知

- `tian.db`：项目、会话、渠道绑定、tasks、runs、attempts、Inbox 及已读状态、通知、幂等记录、`events`，以及可重建的 `history_entries` / `history_fts` / `history_cursors`。
- `pi-session.sqlite`：Pi Durable 会话、任务及 transcript。
- 文件：memory、notes、Inbox 输入和报告。

只有常驻服务写数据库，前端不是权威来源。服务收到 SIGTERM 后有序关闭；下次启动恢复会话、collector 和原截止时间。恢复遵循工具自己的 replay 策略，不保证任意外部操作恰好一次。

Run 结果与完成通知在同一个业务数据库事务中记录。通知用稳定 `requestId` 提交给总管，再标记 delivered；崩溃后可重投并由 Durable 去重。总管忙时进入 follow-up 队列。两个数据库通过操作 ID 与启动核对衔接，没有跨库原子事务。

## History 与 Event

Pi transcript 是会话内容的唯一来源；`tian.db` 里只有可丢弃重建的派生索引。业务事实（Run 状态变化、Inbox 导入、通知送达等）写入 `events` 表，并索引进同一份全文检索。

- `events`：`id`（尽量由调用派生，重放幂等）、`at`、`type`、`actor`、`scope_id`、`goal_id`、`task_id`、`run_id`、`conversation_id`、`summary`、`payload`。API 只有 `record(event)`（INSERT OR IGNORE）、`get(id)`、`list(filter)`；其他功能直接调用 `record`。
- `history_entries`：`(conversation_id, entry_id)` 为主键，保存 scope、kind、role、时间与文本。用户输入、助手文本、工具调用（名称 + 截断参数）、工具结果（截断到 2000 字符）都入索引；空内容与 thinking 跳过。事件以 `conversation_id = ''` 存储，引用为 `event:<id>`。
- `history_fts`：FTS5 `trigram` 分词，中文可直接检索。少于 3 字符的词无法用 trigram 匹配，回退到 `LIKE`；多词查询按 AND 组合。
- `history_cursors`：每个会话的同步游标（事件用单独的游标），按 entry id 升序分页补齐，因此重启只补新增部分，重复同步不会产生重复行。
- 同步时机：启动后后台补齐（不阻塞启动）；会话有新输入、watch 推送变化或空闲后延迟补同步；每次检索前对目标 scope 惰性补齐。维护模式下后台同步暂停。
- 结果按 FTS rank、再按时间倒序排列，去重后按约 1500 token（`ceil(utf8Bytes/3)` 估算）截断。
- 总管工具：`search_history(query, scope?, since?, until?, limit?)` 默认本会话 scope，`scope: "all"` 检索全部，返回 `[2026-10-11 14:02] conv:12#345 user: …片段…`，无命中返回 `(no matches)`；`read_history(ref, around?)` 展开相邻条目或显示事件。

## Inbox

外部参与者向 `<scope root>/.tian/inbox/*.md` 发布：

```md
---
id: external-message-123
from: external-agent
to: chief
ts: 2026-01-01T00:00:00Z
thread: optional-thread
---

消息正文
```

先写非 `.md` 临时文件，再 rename 发布。服务按 `(scopeId, messageId)` 导入 SQLite，逐条记已读。`fs.watch`、启动扫描与定期扫描共同处理遗漏。外部消息生成持久化通知；总管自身和 Run 完成消息不重复唤醒。

## 后续

当前通过 Magpie 网关接入模型。Keychain、远程服务、本机／云端协议、更多工兵类型、定时简报、远端自动更新源、发布签名与公证仍待实现。

参考：[Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)、[OptMem](https://github.com/VictorTaelin/OptMem)、[launchd](https://www.launchd.info/)、[coss](https://coss.com/ui)。
