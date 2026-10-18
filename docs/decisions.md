# 设计决策

这里记录**难以回退、且不看就会困惑**的决定：为什么是这个架构、为什么是这个取舍。实现细节与操作方式不写在这里，分别见 [architecture.md](architecture.md)、[memory.md](memory.md)、[data.md](data.md)、[agent-work.md](agent-work.md)、[channels.md](channels.md)、[service.md](service.md)、[improvement-log.md](improvement-log.md)。

每个决策一节，编号 D1–D11，按领域排序。当前 `DATABASE_VERSION = 4`、`SERVICE_PROTOCOL = 3`；每次 schema 或协议变化都由升级事务覆盖（见 [service.md](service.md#服务升级)）。

原先的 `docs/adr/` 已并入本文件，映射如下：

| 原 ADR | 现章节                                                |
| ------ | ----------------------------------------------------- |
| 0001   | D1 三栏 shell                                         |
| 0002   | D2 Magpie 网关                                        |
| 0003   | D3 TypeScript 服务 + Electron 客户端                  |
| 0004   | D4 Memory 以 SQLite 为唯一写入来源                    |
| 0005   | D5 Task 由待办演进，Run 执行                          |
| 0006   | D6 History 派生索引，Event 记录业务事实               |
| 0007   | D7 调度一次触发一个事务                               |
| 0008   | D8 Telegram 适配器                                    |
| 0009   | D9 App 与服务一起打包、独立升级器（原文件重号，见下） |
| 0009   | D10 Skill 以人工审批为唯一注入闸门（原文件重号）      |
| 0010   | D11 改进日志                                          |

> 0009 曾因分支并行出现两个文件；审批（approvals）的 ADR 仍在未合并的 `m3-approvals` 分支上，合并时按顺序追加为 D12。

---

## D1 · 三栏 shell：导航 / 对话 / 上下文

界面定形为三栏：左栏 scope 与会话列表，中栏对话，右栏上下文检查器（Tasks / Runs / Memory / Inbox）。右栏**常驻、可拖拽调宽、可整体收起**，而不是弹层抽屉。

**背景**：第一版右栏是固定 320px 的 Tabs 面板，塞四块内容，和左栏抢视觉；中途试过把 Runs 收进右侧 Drawer，但 Drawer 盖住对话，验收 diff 时看不到总管说明，开关成本高。

**决定**：

- 两侧各有一条 `PaneDivider`，宽度写入 `localStorage`（`tian.navWidth`、`tian.contextWidth`），属于本地视图状态，不进数据库。
- 右栏是 Codex 式单面板切换，一次只给一种上下文，避免四块堆叠。
- Runs 就地展开：点进 run 详情，diff 用 `@pierre/diffs` 在面板内渲染，Land / Ship / Discard 在 diff 上方。
- 收起后留 44px 竖条，用 transform + 固定列宽做动画，避免对话区逐帧 reflow。

**后果**：对话区宽度随右栏变化，消息容器用 `max-w-3xl` 居中而非满宽；面板宽度换机器不同步（有意为之）；窄窗口不做适配，`minWidth: 880` 兜住。

---

## D2 · 模型统一走本地 Magpie 网关

所有模型请求都打到本机 Magpie（默认 `http://127.0.0.1:3425/v1`），由它路由到各上游。App 不直连 Anthropic / OpenAI / DeepSeek 官方 API，也不从 `~/.pi/agent/auth.json` 导入 key。

**背景**：项目原先按 provider 分支，key 从环境变量或 pi 的 auth 文件读。实际上游都在 Magpie 后面，且模型清单（含 reasoning level、context window、模态）只有网关知道；维护三套 provider 定义和 key 来源是纯负担。

**决定**：

- 启动时 `GET /v1/models` 拉目录，映射成 pi-ai 的 `openai-completions` model 描述（`src/worker/magpie.ts`），用 `createProvider` 注册单个 `magpie` provider。
- 只收录声明支持 `/v1/chat/completions` 的模型（未声明 endpoint 的按支持处理）；`openai-responses` / `anthropic-messages` 专有模型不接入。
- 目录缓存进 `settings.json`：网关不在线时 App 照常打开，模型选择器显示 `offline` 并保留上次目录。
- 认证是占位符：`MAGPIE_API_KEY` 默认 `magpie`，网关本身不做鉴权。
- reasoning level 从网关的 `reasoning_levels` 映射到 pi 的 `thinkingLevelMap`（`none` → `off`），未声明的档位显式置 `null`，避免向上游发送它不认的 effort。

**后果**：换模型只改一个字符串，新增上游是 Magpie 的事，App 无需发版；成本字段一律记 0（网关不回传单价，本地也不猜），用量面板只看 token 数；网关不在跑时发送得到 stream error，UI 靠缓存的目录状态提前提示；覆盖只依赖 `MAGPIE_BASE_URL` / `MAGPIE_API_KEY`，没有设置页输入框。

---

## D3 · 保留 TypeScript 常驻服务与 Electron 客户端

PRD v0.1 的技术方向写的是 Rust Host + GPUI Desktop。项目继续使用现有 Node 常驻服务（launchd）+ Electron/React 客户端：PRD 的架构原则保留，语言与 UI 框架改为现状。

**背景**：PRD 想要的 Host-owned State、Local-first、可恢复、可审计，这个项目已经以 TypeScript 实现：独占锁的常驻服务、Unix socket RPC、升级事务与回滚、Run 恢复、Durable 去重。默认执行器 Pi Durable 本身是 TypeScript 库；换 Rust Host 仍需一个 Node 进程跑 Pi，多一层跨进程协议却换不来 PRD 中任何一项能力。

**决定**：常驻服务继续是唯一的状态所有者，承担 PRD 中 Host 的职责；PRD 的 "GPUI Frontend" 由现有 React renderer 承担；Runtime-agnostic 通过 `WorkerRuntime` 与 `AgentRuntime` 适配器实现，新增执行器实现同一接口，而不是换宿主语言。

**后果**：跨平台时替换 launchd 部分而不是重写服务；将来若出现真实性能热点（如大规模检索），以独立组件引入，不重开整体改写。

---

## D4 · Memory 以 SQLite 为唯一写入来源，保留对齐二叉摘要树

Memory 从 `<scope>/memory/LOG.txt` + `TREE/` 文件迁到 `tian.db`，增加来源、可信度、状态与版本；OptMem 式的对齐区间摘要树保留，作为 Core Memory 的压缩机制，同样存进 SQLite。文件改为单向只读导出。

**背景**：PRD 要求每条记忆有来源和可信度、用户可纠正且保留历史、写入可审计与恢复。追加式文本文件做不到取代与版本；在文件旁边加元数据又会出现两个写入来源。摘要树已能在固定预算内压缩长期记忆并已有压缩流程与 UI，没必要换另一套选择算法。

**决定**：

- 每条 Memory 有按 Scope 递增、不可变的 `seq`，作为摘要树叶子位置；Summary Node 以 `(scope, lo, hi)` 存储。
- 取代（Supersede）= 写入新 Memory（新 `seq`）+ 旧 Memory 标记 `superseded` 并指向新 Memory。覆盖旧 `seq` 的 Summary Node 标记失效，Core Memory 跳过失效节点、下探到子节点或有效原始行，并重新排入压缩队列。
- 删除也是状态变更，不物理删除；写入、取代、删除都追加一条版本记录（操作者、原因、前后内容）。
- Core Memory 预算按 Token 计算（`ceil(UTF-8 字节 / 3)`，默认每 scope 1500），按行数限制的旧规则已废弃。
- 一次性导入旧 `LOG.txt`（`seq` = 行号，来源 legacy、可信度 agent_inferred）与 `TREE/` 节点，之后旧文件移入 `memory/legacy/`。
- 自动提取只产生 `candidate`：候选不进入 `wake()` 渲染与只读导出，由用户晋升或驳回。

**后果**：服务把有效 Memory 与未失效摘要单向导出到 `<scope>/memory/MEMORY.md` 供工兵和人阅读，手改导出文件不会写回；Summary Node 是 Agent 写的派生内容，可信度不高于它覆盖的 Memory，不得作为高优先级指令；数据库版本变化由升级事务备份与回滚覆盖（见 [service.md](service.md)）。

---

## D5 · Task 由待办演进而来，Run 是代码类 Task 的执行

PRD 的 Task 不新建一张表，而由现有待办 `tasks` 表演进：增加 Goal 归属、负责方、完整状态机、触发来源与去重键。Run 保留全部语义，通过 `task_id` 成为代码类 Task 的执行记录。

**背景**：项目里已有两样与 PRD Task 重叠的东西：只有 `open/done` 的待办 `tasks`，以及带 Attempt、执行状态与验收状态分离、可恢复的 `runs`。另建一张 PRD Task 表会留下三个都叫"任务"的概念；把 Run 直接改造成通用 Task 又会把 worktree、Land/Ship 这些代码专属语义带进"每天检查 CI"这类不需要工兵的工作。

**决定**：

- Task 归属用户或 Agent（`owner`）。用户的普通待办 = 无 Goal、归属用户的 Task；旧 `open` 迁移为 `pending`，`done` 迁移为 `completed`。
- 状态：`pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`；转换集中在一处校验，非法转换抛错。执行状态与结果（`outcome`：达成、未达成、无变化）分别记录。
- 每个 Task 有唯一 `dedupe_key`（如 `sched:<schedule>:<触发时刻>`），重启或重复触发不会生成第二个 Task。
- 一个 Task 可以有零个或多个 Run；只有需要改文件的工作才派发 Run。Run 的执行状态、验收状态与恢复逻辑不变。
- 由总管自己完成的 Task（查询、汇总、通知）没有 Run，直接在 Goal 的 Conversation 中执行并写回结果。
- 界面上不再单独维护 Schedule 视图：Goals 视图同时展示 Goal 与按状态分组的 Task Board。

**后果**：对外只出现 Goal / Task / Run 三个词；Run 完成不等于 Task 完成，Task 的完成由总管依据 Run 结果与验收状态判断，或由用户确认；用户的普通待办与 Agent 的调度任务共用同一张表，靠 `goal_id` 与 `owner` 区分。

---

## D6 · History 是 Pi transcript 的派生索引，业务事实统一写入 Event

History 与审计落在 `tian.db` 的两个区域：`events` 保存已发生的业务事实，`history_entries` + `history_fts` + `history_cursors` 保存可丢弃重建的检索索引。Pi 的 `pi-session.sqlite` 仍是会话内容的唯一来源。

**背景**：Pi Durable 已持久化全部会话条目，但检索它要理解它的分页、fork 与 head 语义；总管也不该每次提问都把历史塞进 Prompt。PRD 要求按时间、Scope、Conversation、关键词检索消息、工具调用与结果，以及 Task/Run 状态变化与审批决定，并给出可定位的引用。同时 PRD 要求状态变化写入 Event 并驱动通知，而此前只有通知 outbox，没有统一审计记录。

**决定**：

- **Event 表**：`events(id, at, type, actor, scope_id, goal_id, task_id, run_id, conversation_id, summary, payload)`。`id` 尽量由调用派生（如 `run:<id>:dispatched`），写入用 `INSERT OR IGNORE`，重放与重启不产生重复事件。API 只有 `record` / `get` / `list`，其他功能直接调用 `record`。
- **派生索引**：`history_entries` 以 `(conversation_id, entry_id)` 为主键；FTS5 用 `trigram` 分词（中文可检索）。事件索引进同一张 FTS 表，以 `conversation_id = ''` 区分，引用为 `event:<id>`。
- **增量同步**：`history_cursors` 记录每个会话已索引的最大 entry id（事件用单独游标），按 entry id 升序分页，只处理游标之后的部分；删表后一次全量同步即可恢复。
- **同步时机**：启动后后台补齐（不阻塞启动）、会话有新输入或 watch 推送变化后延迟补同步、每次检索前对目标 scope 惰性补齐；维护模式下暂停。
- **检索**：trigram 无法匹配少于 3 个字符的词，这些词改用 `LIKE`；多词按 AND 组合。结果按 FTS rank、再按时间倒序，去重后按约 1500 token（`ceil(utf8Bytes/3)` 估算）截断，无命中明确返回 `(no matches)`。
- **引用**：`conv:<conversation>#<entry>` 与 `event:<id>`；`read_history` 用 entry id 窗口展开上下文，事件显示 actor、summary 与 payload。

**后果**：History 可随时删除重建，索引格式变化不需要迁移数据（Pi storage 损坏才是不可恢复的）；索引写入不进 Pi 事务，崩溃后最多丢一段未同步的尾部，下次同步补齐；事件成为审计来源，审批与 Task 只需 `record`，不必各自设计日志；检索质量受 trigram 限制，两字中文词走 `LIKE` 全表扫描，数据量继续增长后需评估 bigram 或额外 n-gram 索引。

---

## D7 · 调度以「一次触发一个事务」推进，唤醒内容只带 Goal 状态与 Task

Schedule 到期时，服务在一个数据库事务内完成三件事：按 `sched:<schedule>:<触发时刻>` 创建（或复用）Task、向 Goal 专属会话写入 Notification、从**当前时刻**推进 `next_fire_at`。停机或休眠期间错过的触发因此合并为一次。

**背景**：F08 要求「没有新消息时自动执行」，同时要求重启不重复执行、错过不补跑风暴。这几条互相拉扯：Task 创建、通知投递与调度指针推进若分属不同事务，任何一次崩溃都可能产生两个 Task、或丢掉一次唤醒、或把同一触发重放很多次。cron 语义本身也有歧义：推进到「上次计划 + 1」会在停机后连发多次，推进到「当前时刻之后的第一个」则把错过合并成一次。

**决定**：

- **单事务**：Task、Notification、`next_fire_at` 在同一个 `Db.transaction` 内写入。事务支持嵌套（内层用 savepoint），因此调度器可以在操作 ID 重放的事务里安全调用。
- **去重键是触发槽位**：`dedupe_key = sched:<scheduleId>:<到期时刻 ISO>`，到期时刻取自 `schedules.next_fire_at`，重启后重放同一槽位命中同一条 Task；`notifications` 的主键 `task:<taskId>` 再保证通知只入队一次。
- **从 NOW 推进**：`next_fire_at = cron.next(now)`，而不是 `cron.next(上一个计划时刻)`。停机三天后只跑一次，之后回到正常节奏。
- **唤醒内容最小化**：通知只包含 Goal 的 objective / success criteria / constraints / current state / next action 与本次 Task，不重建会话历史；总管需要细节时自己检索。
- **非 active 的 Goal 不触发**，但仍推进指针，恢复后从未来开始；孤儿 schedule 直接禁用。
- **每日预算**：按 `tasks.created_at >= 本地零点` 计数（`blocked` 不计）。超限时创建一条 `blocked` Task（每个 Goal 每天一条，`dedupe_key = cap:<goalId>:<日期>`）并写一条去重后的用户提醒，而不是静默丢弃或无限重试；blocked Task 不唤醒总管。
- **定时器**：`setTimeout` 睡到最早的 `next_fire_at`，上限 60 秒并 `unref`；关闭与维护期间不触发。时钟可注入，测试不等待。

**后果**：调度器与总管职责分离——调度器只决定何时唤醒，做什么由总管在 Goal 会话中决定并写回；一次触发最多一条 Task、一条 Notification，重复触发是幂等空操作；停机期间多次触发只产生一次执行，代价是不补跑，这符合「活动不等于进展」的产品原则；预算判断依赖本地时区零点，跨时区旅行或改系统时区会让「今天」的边界移动；定时器上限 60 秒意味着新增 schedule 最多 60 秒内生效，每次 tick 重新查询，无需唤醒信号。

---

## D8 · Telegram 适配器：long polling + 白名单 chat，转发以会话游标恰好一次

渠道网关的第一实现是 Telegram Bot：服务进程内长轮询收消息，白名单授权，chat 绑定到稳定会话；总管在会话中的完成回复回发到 chat。不做公网回调，不引入新依赖。

**背景**：`openSession({channel, externalId, scopeId})` 已提供稳定的渠道绑定与 Durable `requestId` 去重，但没有渠道真正收发消息。PRD F11 要求 Telegram Bot 用 long polling 接入，按 chat ID 白名单授权，token 存于 `<dataDir>/service.env`。适配器必须是服务的一个可失败组件：没有 token 时整个服务照常工作。

**决定**：

- **传输**：`getUpdates` 长轮询，用全局 `fetch`，无新依赖。网络或 HTTP 错误按指数退避（1s 起，封顶 60s），循环永不抛出；offset 持久化在自己的 `telegram_state` 表，只有在输入被 Durable 稳定受理（`submit` 返回）后才推进，因此重启不重放已处理的更新，重复投递的同一条更新靠 `tg:<chatId>:<message_id>` 去重。
- **授权**：`TELEGRAM_ALLOWED_CHAT_IDS` 逗号分隔白名单，非白名单 chat 只记录 chat ID 后忽略。token 只出现在请求 URL 路径，错误日志将其改写为 `[REDACTED]`。
- **会话与 scope**：chat 的当前 scope 持久化在 `telegram_chats` 表（默认 `global`）；`/scope` 切换时复用渠道绑定为该 (chat, scope) 打开独立 conversation。`/status`、`/help` 是适配器本地命令，直接读 `tian.db`，不进入模型。
- **出站转发**：以 conversation 为单位维护持久游标（`telegram_forward_cursor`），只转发已提交的 `pi.assistant` 条目中的文本块（流式片段存于 `pi.live` 文档，天然不会转发；thinking 与 tool call 块被过滤）。触发采用「重启补扫 + conversation watch 推送」：启动时从游标补扫，之后由 watch 在新条目提交时即时触发；发送成功后才推进游标。消息按行边界拆分为不超过 4096 字符的纯文本。
- **可测试与配置边界**：Bot API 收敛为 `getUpdates` / `sendMessage` 两个方法的注入接口，测试用假 API 驱动真实轮询循环、退避与游标恢复。渠道配置只在 `service/entry.ts` 读取 `service.env` 后显式传入（`ResidentServer` → `Service`）；`Service` 不读 `process.env`，没有配置就不启动，测试与临时实例不会触网。
- **维护与授权**：进入维护时先停网关再检查空闲，`stop()` 等待在途提交与转发真正结束；白名单在唯一出站路径（`forwardChat`）上校验，被移出白名单的 chat 不再收到任何主动输出，也不再挂 watch。
- **触发合并**：conversation watch 的每次视图变化只置脏标记，每个会话最多一个进行中加一个待执行转发，避免流式更新引发大量分页读取。

**后果**：审批与 Goal 通知可复用同一接入（命令入口已在适配器本地命令层预留，主动推送复用转发通道）；出站转发的"恰好一次"以进程生命周期为界，进程在「发送成功」与「游标落库」之间崩溃会重发一条，Telegram 无客户端去重键，这是纯轮询方案的理论下界；对端永久失败（如 bot 被拉黑）会阻塞该会话后续转发并每次触发记录错误，不自动跳过，避免静默丢消息；非文本消息与群组话题暂不处理，白名单为空时适配器启动但不放行任何 chat。

---

## D9 · App 与后台服务一起打包、分开安装，由独立升级器协调切换

沿用 D3 的 Electron App + Node 常驻服务架构。每次发布提供一个包含 App、配套服务和升级器的 `.app`；安装后的服务独立运行，用户数据保存在稳定的数据目录。升级时由临时启动的升级器协调停止、备份、替换和启动检查，避免出现「界面更新了，后台还跑着旧代码」。

**背景**：单独把新的 `.app` 拖过去覆盖只替换 App 文件，不会替换已独立安装的服务；而 App 与服务版本必须配对（协议、数据库版本、产物哈希）。因此需要显式管理配对关系，并让切换过程可检查、可回滚。

**决定**：

- **包内三件套**：Electron App、配套服务与它自己的 Node 运行时、升级器。服务不依赖开发 checkout、系统 Node 或 Electron 进程存活。
- **三个位置分开管理**：App 在 `/Applications`，数据与服务 release 在 `~/Library/Application Support/Tian Agent/`，登录自启动入口是 `~/Library/LaunchAgents/dev.tian.agent.plist`。
- **升级器在 App 之外运行**：否则 App 退出或自身文件被替换时无法继续。
- **升级是一次可恢复的多步事务**：校验并暂存（同一应用、版本更高、配套服务一致、平台架构匹配、校验所有文件哈希；有开发者签名时要求同签名）→ 检查空闲并进入维护 → 退出旧 App、停止旧服务、在存储锁保护下备份数据库 → 启动新版并保持维护 → 替换并启动新版 App、等待界面确认 → 提交、解除维护、清理。
- **提交点是回滚边界**：提交前失败可恢复旧 App、旧服务和数据库快照；提交后只保留新版，靠「恢复未完成升级」入口继续激活，不自动恢复旧数据库。
- **版本校验显式拒绝**：升级器只接受它支持的协议与数据库版本，不假设任意版本间可升可降。
- **保留策略**：成功后保留当前与上一份 release、最近三份数据库备份；已完成的 app-update 目录按同样规则清理。

**后果**：允许短暂停机，换取单个写入者、可检查的切换和提交前恢复；升级日志、维护标记与快照都落在数据目录，进程退出后仍可读；不提供零停机升级，也不承诺 App 目录与数据库在断电时整体原子提交；数据库备份只覆盖应用管理的两份 SQLite 及其辅助文件，不回滚用户项目里的代码、外部文件或已发生的远端操作；当前来源是用户选择的本地 `.app`，远端版本检查、下载源、签名与公证尚未配置；服务管理依赖 `launchd`，其他平台需另行实现。

---

## D10 · Skill 以人工审批为唯一注入闸门，经验提取只产候选

Skill 的生命周期是 `candidate → approved → retired / superseded`，其中 candidate → approved 只能由用户执行；Agent 没有任何工具能写 `skills` 表。dispatch 时按名称/关键词匹配 approved 版本注入工兵，`runs.injected_skills` 记录注入了哪些版本；提取器是可注入接口，默认实现是确定性规则。

**背景**：F09/F10 要求从 Run 轨迹中沉淀可复用流程并按任务加载。产品原则「经验 ≠ 已验证的 Skill」是硬约束：一次未经验证的成功不得变成全局规则，未批准的候选绝不能进入任何 prompt。同时 Run 管线已经稳定（隔离 worktree、幂等派发、执行与验收分离），skill 不能破坏这些性质；M5 不能依赖模型调用。

**决定**：

- **一表多版本**：`skills(id, scope_id, name, version, status, verification, body, source_refs, …)`，`(scope_id, name, version)` 唯一。同一流程的新版本批准后，旧 approved 版本置 `superseded`；版本行永不删除，历史即审计。表归 `SkillRegistry` 所有，与 `goals` 等特性表同模式（`Db.sqlite` + `Db.transaction`）。
- **审批是用户特权**：`approve` 只接受 `candidate` 状态，且只能经 IPC/UI 触发。总管与工兵没有写 skill 的工具；提取只产生候选。
- **提取器可注入**：`ExperienceExtractor.extract({ run, report, attempts, messages }) → candidates`。默认 `RuleBasedExtractor` 离线确定性：仅当 Run `done` 且报告含明确步骤证据（steps/procedure/workflow 标题段，或 ≥3 条连续列表项）才产出，失败 Run 一律不产候选。同名同文的重复提取合并 `source_refs` 而非新增版本；模型提取器后续实现同一接口即可，管线不动。
- **两层注入防御**：dispatch 时 `matchApproved`（名称整体或全部 token 匹配任务文本，短 ASCII token 加词边界）结果记入 `runs.injected_skills`；`AgentRuntime` 渲染工兵指令时对每个 ref **再次校验**状态为 `approved` 才输出 body。即使 run 行被错误写入，候选也进不了 prompt。
- **审查失败不伤运行**：`reviewExperience` 在 Run 收尾后调用且整体 try/catch；提取器抛异常只留日志，Run 状态与既有数据不受影响（提取写入在事务内）。
- **失败标记，人工回滚**：加载某 skill 版本的 Run 失败时，该版本 `verification = failed`（状态不变，由用户决定）；UI 一键 `rollback` 把当前 approved 版本置 `retired + failed`，并恢复最新的 superseded 版本为 approved。不做自动回滚——失败原因未必是 skill 本身。
- **注入留痕与审计**：`runs.injected_skills`（JSON 数组）回答「这次 Run 的工兵看到了哪些流程」；`skill.candidate / approved / retired / rollback` 事件进 `events` 表（操作者、版本、被取代者、原因）。
- **数据库升级**：新增 `runs.injected_skills` 列时提升 `DATABASE_VERSION`；`Db` 构造时若确需升级（0 < version < 当前版本），先 `VACUUM INTO` 做一致快照，再在单事务内迁移，失败整体回滚并保留备份文件供恢复。

**后果**：工兵看到的 skill 永远是用户批准过的版本，注入路径可以用 `runs.injected_skills` 复盘与回放；候选名称取自 Run prompt 首行的 slug，措辞不同会得到近似重复的候选，人工审批（或未来的合并工具）负责去重，匹配也停留在名称/关键词级别；`verification` 目前只有 `unverified → failed` 两个可达值，`verified` 预留给「多次成功 + 人工确认」；升级备份文件留在数据目录（`tian.db_v<old>.backup`），由下一次同版本升级覆盖，不做自动清理。

---

## D11 · 改进日志：用户与总管可写、系统错误自动指纹化

Improvement Log 是 `tian.db` 中一张独立的 `improvements` 表，记录值得改进的产品问题、使用摩擦、想法和成功经验；系统异常也自动落入同一张表，并按指纹合并。它不是审计 Event，也不是注入 Prompt 的 Memory。

**背景**：`events` 是 append-only 的审计事实，不适合承载「这个交互很烦」或「这里可能是个 bug」的判断；`service.log` 是 launchd 重定向的原始 stdout/stderr，没有结构化上下文、没有去重、没有状态，也不会出现在 App 里；用户反馈和总管观察到的摩擦此前只能停留在会话里，结束后就难以再次找到。

**决定**：

- **对象与归属**：一条条目属于一个 Scope（`global` 或项目），字段包括 `kind`（issue / friction / idea / win）、`status`（open / promoted / resolved / dismissed）、`severity`、`summary`、`detail`、`source`（user / chief / system），以及可选的 `area`、`fingerprint`、`occurrences`、`first_seen_at`、`last_seen_at`、`task_id` 和 `conversation_id` / `run_id` / `event_id` 引用。细节正文最多 20k 字符，列表只返回摘要，展开时再取正文。
- **两个写入面**：总管的 `log_improvement` 工具和 App 的 Log 视图写同一张表；UI 手工写入固定为 `user`。
- **自动捕获**：服务内有一个 `reportIssue(area, error, context)` 汇点，替换原先只写 `console.error` 的关键错误路径（启动/监听、Inbox、History 同步、通知投递、调度器、Run、Land/Discard/Ship、Telegram、渲染层未捕获异常）。条目按 `area + error name + code + message` 生成指纹；同一 Scope 内已有 `open` 或 `promoted` 的同指纹条目时只累加 `occurrences`、更新 `last_seen_at` 与更高的 severity。错误正文脱敏 bot token、`Bearer`、`sk-*`、`api_key` / `token` / `secret` / `password` 赋值。
- **不阻塞主流程**：自动捕获与渲染层上报都是 best-effort，写入失败只回到 `console.error`；进程级 `uncaughtExceptionMonitor` 在 Node 默认崩溃路径之前尝试写入，数据库不可达时仍保留原有崩溃行为。
- **提升为 Task**：`promote` 在同一事务里创建（或复用）一条带 `dedupe_key = improvement:<id>` 的待办 Task，并写回 `task_id` 与 `status = promoted`；重复点击不会创建第二条 Task。提升动作写入 `improvement.promoted` Event。
- **UI**：左侧一级导航增加 Log，默认显示 `active`（open + promoted），可按状态、kind、Scope 过滤；行内展开详情并执行 Promote / Resolve / Dismiss / Reopen。侧栏 badge 只显示 `open` 数量，新条目默认写入当前 Scope。
- **边界**：不替代 `service.log` 的原始调试输出，不自动生成 Memory，不进入每次 Prompt，也不承诺审计级的 append-only（状态可变）。Event 表保持业务事实与审计职责。

**后果**：自动错误形成可浏览、可计数的待办，持续故障显示为一条 `×N` 记录；指纹只含错误语义、不含堆栈位置，同一版本内稳定，但不同原因可能共用一条记录；Log 视图默认跨 Scope，避免在项目会话中看不到 Global 的服务异常；新增协议命令与 `improvements` 事件使 `SERVICE_PROTOCOL` 升到 3，表由 `ImprovementStore` 自己创建、不改变 `DATABASE_VERSION`，旧服务忽略该表，新客户端不会连接旧协议服务。
