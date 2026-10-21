# 设计决策

这里记录**难以回退、且不看就会困惑**的决定：为什么是这个架构、为什么是这个取舍。实现细节与操作方式不写在这里，分别见 [architecture.md](architecture.md)、[memory.md](memory.md)、[data.md](data.md)、[agent-work.md](agent-work.md)、[channels.md](channels.md)、[service.md](service.md)、[improvement-log.md](improvement-log.md)。

每个决策一节，编号 D1–D15，按领域排序。当前 `DATABASE_VERSION = 7`、`SERVICE_PROTOCOL = 7`；每次 schema 或协议变化都由升级事务覆盖（见 [service.md](service.md#服务升级)）。

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

> 0009 曾因分支并行出现两个文件；审批（approvals）的 ADR 仍在未合并的 `m3-approvals` 分支上，合并时追加为下一个空闲编号（D13 已被「Run 级 worker 模型与思考强度」占用，D14 为管理者命名——见下方条目，哪个先合并以实际落地顺序为准）。

---

## D1 · 三栏 shell：导航 / 对话 / 上下文

界面定形为三栏：左栏 scope 与会话列表，中栏对话，右栏上下文检查器（Tasks / Runs / Memory / Inbox）。右栏**常驻、可拖拽调宽、可整体收起**，而不是弹层抽屉。

**背景**：第一版右栏是固定 320px 的 Tabs 面板，塞四块内容，和左栏抢视觉；中途试过把 Runs 收进右侧 Drawer，但 Drawer 盖住对话，验收 diff 时看不到总管说明，开关成本高。

**决定**：

- 两侧各有一条 `PaneDivider`，宽度写入 `localStorage`（`tian.navWidth`、`tian.contextWidth`），属于本地视图状态，不进数据库。
- 右栏是 Codex 式单面板切换，一次只给一种上下文，避免四块堆叠。
- Runs 就地展开：点进 run 详情，diff 用 `@pierre/diffs` 在面板内渲染，Land / Ship / Discard 在 diff 上方。
- 两侧折叠都不留竖条：开关统一放在内容区标题栏（左端侧栏、右端右栏），折叠用 transform + 固定列宽做动画，避免对话区逐帧 reflow。早先右栏收起后的 44px 竖条已移除。
- 归档会话只从侧栏收起并让出唤醒目标，不删 transcript：`conversations.archived_at` 是单一事实，`latestConversation` 同时排除归档会话与项目管理者会话，避免无主通知写进已收起的会话。

**后果**：对话区宽度随右栏变化，消息容器用 `max-w-3xl` 居中而非满宽；面板宽度与折叠状态换机器不同步（有意为之）；窄窗口不做适配，`minWidth: 880` 兜住；归档会话仍可被 History 检索命中，不做二次隐藏。

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

## D4 · Memory 以 SQLite 为唯一写入来源，Core Memory 改为显式选择

Memory 从 `<scope>/memory/LOG.txt` + `TREE/` 文件迁到 `tian.db`，增加来源、可信度、状态与版本。Core Memory 不再是"按 `seq` 递归压缩全部记忆的摘要树"，而是由用户或 Chief **明确选入**的少量条目；其余有效 Memory 仍可检索。文件改为单向只读导出。

**背景**：PRD 要求每条记忆有来源和可信度、用户可纠正且保留历史、写入可审计与恢复。追加式文本文件做不到取代与版本；在文件旁边加元数据又会出现两个写入来源。摘要树能在固定预算内压缩长期记忆，但它解决的是"长度"而不是"哪些事实值得常驻"：8 条短事实完成所有 pending 合并后，Core 只剩一条根摘要，模型看不到原始细节；它还需要 Chief 立即处理 COMPRESSION DUE、维护对齐区间与并发失效，并曾在"旧摘要覆盖新纠正"时把已纠正的事实带回来（[调研](research/memory-review.md#p0旧摘要可以把已纠正的事实带回来)）。选择比压缩更直接地决定常驻内容。

**决定**：

- 每条 Memory 有按 Scope 递增、不可变的 `seq`，只表示插入顺序与引用，不再承担树叶子位置。
- Core Memory 由 `memories.core` 标记：新写入默认 `core = false`（可检索但非常驻）；`core: true` 或 `select #seq` 显式选入；`deselect #seq` 只移出 Core，不改变 active 状态，也不等于 `forget`。
- 预算按 Token 计算（`ceil(UTF-8 字节 / 3)`，默认每 scope 1500），覆盖**最终渲染文本**：序号、类型、可信度、换行和用量页脚都计入。选入超额原子拒绝并返回当前用量；运行时不静默裁剪、不静默驱逐、不维护永远超额的 selected 列表。
- 取代（Supersede）= 写入新 Memory（新 `seq`）+ 旧 Memory 标记 `superseded` 并指向新 Memory。旧 Memory 立即离开 Core，且不会被自动重新选入。修订优先保证纠正生效：替换放不下时新事实仍保存、`coreDropped` 明确返回，旧事实不保留在 Core。
- 删除也是状态变更，不物理删除；写入、取代、删除、选入、移出、补证据都追加一条版本记录（操作者、原因、前后内容）。
- 来源贯穿写入与读取：操作者与来源分开；`source: "user"` 只在存储语句与当前用户输入整体在空白规范化后**完全相等**时确认（大小写/否定/路径均保留），系统唤醒、Worker 输入、通知正文、截取/翻译/改写/概括都不确认（降为 `agent_inferred` 并说明）；无论是否确认，`sourceRef` 都绑定**最新**输入 entry（`conv:<id>#<entry>`，图片/空文本输入也绑定但不确认），修订引用本次纠正而非旧来源。
- 同 Scope 规范化空白后完全相同的正文精确去重（大小写保留），重复写返回原 `#seq`；新的用户确认/来源追加 `evidence` 版本、重建导出并推进版本号而不丢失；历史行不会被不加区分地复活。写入、修订、删除、选入、移出都以 durable `taskId:callId` 幂等；`revise` 到相同正文仍走补证据路径。
- 一次性导入旧 `LOG.txt`（`seq` = 行号，来源 legacy、可信度 agent_inferred），旧文件移入 `memory/legacy/`；旧 `TREE/` 只移入 legacy，不再导入。升级时对既有 active 记忆做一次确定性 Core 选择（用户确认优先，其次 preference/decision，按 `seq` 逐条校验预算），其余保留可检索；结果记录在 `memory_meta`，同版本重开不重做。
- 自动提取只产生 `candidate`：候选不进入 `wake()` 渲染与只读导出，promote 只把候选转为 active，仍需用户或 Chief 显式 `select` 才常驻；候选的 supersede 目标在等待期间被用户修订时，晋升失败而不是覆盖新事实。

**后果**：服务把有效 Memory（标注是否 `[core]`）与 Core 用量单向导出到 `<scope>/memory/MEMORY.md` 供工兵和人阅读，手改导出文件不会写回；旧 `memory_nodes` 在升级事务中改名为 `memory_nodes_retired`，仅保留现场、不再读取，新库不创建；Core 的取舍从"压缩算法"变成显式选择，需要模型或用户主动管理，但不会再因递归摘要丢掉原始事实，也不会让过期摘要复活；数据库版本变化由升级事务备份与回滚覆盖（见 [service.md](service.md)）。

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
- **检索**：trigram 无法匹配少于 3 个字符的词，这些词改用 `LIKE`；多词按 AND 组合。Memory、History、Notes 共用同一套查询计划（`worker/search.ts`），避免三份重复算法。结果按 FTS rank、再按时间倒序，去重后按约 1500 token（`ceil(utf8Bytes/3)` 估算）截断，无命中明确返回 `(no matches)`。
- **长内容**：tool args / results 以**完整源单元**入索引（每条 call / result 一行，不设持久截断阈值），不在任意 chunk 边界切词或截断尾部，跨词多词查询不会漏检；搜索结果引用始终指向整个 entry，`read_history` 按 ref 从原始 transcript（或完整可重建索引）分页展开，返回 `chars a-b of n` 与 continuation offset，Unicode 按 code point 分页。多消息 entry 以 `:msg:<n>` 区分，tool call 以 `:call:<n>` 区分（编号跨整个 entry），`read_history` 默认输出有界，邻居只显示单行预览。
- **索引格式升级**：格式版本记录在 `memory_meta`；不匹配时清空全部派生表与**所有**游标（会话、事件、Memory Worker），由下一次同步从 Pi 与 Event 表自动重建。rowid 在重建后没有意义，保留任何旧游标都会漏掉来源；Memory Worker 依赖既有精确/相似去重避免候选重复，已驳回的候选不会复活。
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
- **UI**：Log 面板位于 Settings 内（左侧锚点导航的 Log 段），默认显示 `active`（open + promoted），可按状态、kind、Scope 过滤；行内展开详情并执行 Promote / Resolve / Dismiss / Reopen。侧栏 Settings 齿轮上的 badge 只显示 `open` 数量，新条目默认写入当前 Scope。
- **边界**：不替代 `service.log` 的原始调试输出，不自动生成 Memory，不进入每次 Prompt，也不承诺审计级的 append-only（状态可变）。Event 表保持业务事实与审计职责。

**后果**：自动错误形成可浏览、可计数的待办，持续故障显示为一条 `×N` 记录；指纹只含错误语义、不含堆栈位置，同一版本内稳定，但不同原因可能共用一条记录；Log 视图默认跨 Scope，避免在项目会话中看不到 Global 的服务异常；新增协议命令与 `improvements` 事件使 `SERVICE_PROTOCOL` 升到 3，表由 `ImprovementStore` 自己创建、不改变 `DATABASE_VERSION`，旧服务忽略该表，新客户端不会连接旧协议服务。

---

## D12 · 项目管理者：每项目一条持久会话，委派即 Task 的三级链路

Manager（项目管理者）是介于总管与工兵之间的项目级 Agent：每个项目一条持久会话，总管以 Task 为单位委派项目管理，管理者执行、收口并回报。

**背景**：总管直接管理所有项目的 Task 与 Run 时，每个项目的执行细节都挤在同一条会话里；而且「委派」如果只是消息就没有 id / 状态 / 结果——总管看不到哪些事项还挂在外面，管理者的汇报也无法对应到具体委派。需要一个项目级的管理者承接「本项目日常管理」，并让委派本身成为可追踪的工作项。

**决定**：

- **委派即 Task**：`delegate(project, title, briefing, goal?)` 在一个事务内创建 `assignee='manager'`、`report_to=发起总管会话` 的 Task（`dedupe_key = delegate:<operationId>`）和 `kind='delegation'` 的 `manager_messages` 行，然后唤醒管理者。管理者 `complete_task` / `fail_task` 收口时由 `onTaskClosed` 回调把结果按 `report_to` 通知对应总管；带 goal 的委派提醒总管 `update_goal`——Goal 始终归总管。
- **问答有归属**：`manager_messages` 增加 `kind`（delegation / message / question / answer / report）、`task_id`、`reply_to`、`closed_at`。管理者 `ask_chief` 写 `question` 行并阻塞轮询匹配 `reply_to = question.id` 的 `answer`；超时在单个事务内「关闭 + 复查」，答覆竞态不丢失；重启后重放直接返回已存答案或超时文案，不再等待。无关消息不会被误当答案吞掉。
- **恰好一次唤醒**：每条总管→管理者消息对应一次唤醒通知，唯一例外是「管理者仍在阻塞等待」的 `answer`——由 `ask_chief` 直接返回不唤醒；问题已关闭后的迟到答覆补一次唤醒。`check_msgs` 因此被移除。
- **按 Task 路由上行**：`wakeChief` 的目标是会话级 `report_to`——优先本 Task 的 `reportTo`，其次项目内最新委派 Task 的 `reportTo`，最后回落 scope 最新非 Manager 会话。不再需要 `manager_links` 表（已建库里的表保留不删）。
- **边界在工具层**：Manager 装配 `managerExtension`，工具构造时锁定本项目——`taskExecutionTools` 带 `taskScope` 守卫、记忆写入 `lockToOwnScope`（可读 Global）、`dispatch` 强制本项目、Run 与 history ref 限本项目；总管的 `taskExecutionTools` 传 `refuseAssignee='manager'` 拒绝对委派 Task 执行 start/complete/fail，`send_run_msg` 拒绝管理者名下的 Run（只读工具放行）；`RunOrchestrator.dispatch` 校验 task 的 scope 与项目一致。Manager 没有 shell / CodingTools。
- **会话即项目绑定、channel 保留**：Manager 是 `channel_sessions` 中 `channel = 'manager'`、`external_id = scope_id = project_id` 的持久会话，每项目至多一条，`ensureManagerConversation` 惰性创建且禁止 Global；公开 `openSession` 拒绝 `channel='manager'` 绑定，防止客户端伪造「Global 管理者」。`latestConversation`（scope 级无主通知的默认目标）排除 Manager 绑定；启动时按 `managerConversationIds` 给存量会话分别重配 chief / manager extension。
- **Tian 直连管理者**：除总管委派外，Tian 可经 `openManager(projectId)` 命令（侧栏项目作用域的管理者按钮）直接打开管理者会话派活；`ConversationInfo.role`（`'chief' | 'manager'`）随 `openManager` / `openSession` / `listConversations` 等全链路透出（由 `channel_sessions` 的 manager 绑定派生，不落 `conversations` 列），`SERVICE_PROTOCOL` 升至 5。Tian 轮次（本轮 `currentInput` 为 `kind='user'`）里，`ask_chief` 与 `report_chief` 被工具层守卫挡下并返回提示语——不写 `manager_messages`、不唤醒总管；例外是 `report_chief` 带 `assignee='manager'` 的本项目 Task id 时仍按该 Task 的 `report_to` 上报。Tian 直接派的 Task 由 `add_task` 创建（`assignee = NULL`），静默收口不通知总管；`remember(source:'user')` 在 Tian 轮次照常记 `user_confirmed`。

**后果**：委派变成可枚举、可追踪、可归因的工作项——总管能列出未完成委派、汇报能对应到 Task；问答语义清晰，答覆不再被无关消息吞掉或重复投递；Manager 拥有项目内完整管理回路，越权写入被工具层拦截。Tian 直连让项目琐事绕过总管直达管理者且不打扰总管会话，同时不削弱上行通道——归属总管委派的 Task 在 Tian 轮次中收口、上报照常。局限：Tian 让管理者「把非委派事项转告总管」目前不实现——`report_chief` 仅放行委派 Task；`ask_chief` 阻塞轮询（2 秒间隔、默认上限 5 分钟）；用户界面操作（doneTask）不受 assignee 限制，作为最终逃生通道保留。

## D13 · Run 级 worker 模型与思考强度：dispatch 参数钉选，校验收口在 Service

总管与管理者派活时可给本次 Run 钉一个模型和思考强度（effort），不再一律使用全局默认模型。

**背景**：worker 历来用 `settings.model` 全局默认模型、按模型自带 effort 跑。有些任务值得用更强的模型或更高的思考强度，另一些只是跑腿、便宜快速即可。需要让总管和管理者在 `dispatch` 时按任务指定，而不是改全局配置。

**决定**：

- **dispatch 钉选**：总管 `dispatch(project, prompt, task?, model?, thinking_level?)` 与管理者 `dispatch(prompt, task?, model?, thinking_level?)` 各增加两个可选参数——`model` 是 Magpie catalog 的 model id，`thinking_level` 是 pi 的 level 名（off/minimal/low/medium/high/xhigh/max）。省略时沿用全局默认模型与该模型自己的默认 effort。
- **校验收口一处**：总管与管理者的 dispatch dep 都指向 `Service.dispatchRun`，其中 `resolveWorkerSpec` 对照 `catalogState().models` 校验——model 必须存在、thinking_level 必须被目标模型支持；gateway 的 `none` 映射为 pi 的 `off`。校验失败抛错、不创建 run，两条路径同一套规则。
- **持久化与消费**：`runs` 表在同一 v7 迁移里新增 `model`、`thinking_level` 两个可空列（NULL = 继承默认），`run.dispatched` 事件 payload 带上钉选值；`AgentRuntime.create` 把钉选的 `{provider: 'magpie', modelId}` 与 `thinkingLevel` 传给 pi，未钉时回落 `settings.model`。
- **可发现性**：总管与管理者的 `<state>` 块各多一行 `worker models:`（catalog 为空时不出现），列出每个 model id、它支持的 thinking level 和默认标记；工具描述指引从该行取值。
- **兼容**：`RunInfo.model` / `thinkingLevel` 为可选可空字段，旧库行与旧 fixture 不受影响。

**后果**：总管可以把重活钉到强模型 / 高强度、跑腿钉到便宜模型，同一个项目内不同 Run 并存不同配置；错值在 run 创建前被拦下，不会产生半初始化 run。局限：thinking_level 单独传入时按默认模型校验，默认模型不在 catalog 中会拒绝（需先钉 model）；UI 侧手动派活 / 复跑暂不接这两个参数。

## D14 · 管理者命名：名字只是称呼，绑定会话才是管理者

项目可以给管理者起一个名字（如「阿七」），总管在 `<state>` 与 `list_scopes` 里按名字称呼它；但名字纯粹是展示标签，**不**决定管理者是否存在。

**背景**：总管面对一串项目时只能看到项目名，「该项目的管理者」是个匿名角色，汇报与委派都难以指认。给管理者一个名字能让上下文更易读，但名字本身极易被误解成「已配置管理者」——必须由真实的绑定会话来裁决。

**决定**：

- **projects.manager_name 可空列**：`addProject` / `updateProject` 接受可选 `managerName`（空白与显式 null 都表示未命名）；UI 在项目设置与新建项目对话框里提供输入框。`ScopeInfo.managerName` 随 listScopes 透出，`SERVICE_PROTOCOL` 升至 6。
- **名字不创造管理者**：管理者存在的唯一判据是 `channel_sessions` 里 `channel='manager'` 的绑定（`Db.hasManager`，由 `openManager` 建立）。`delegate` 与 `send_manager_msg` 在 `hasManager` 为假时直接拒绝并报统一错误「先打开管理者」，不再像 D12 那样惰性创建会话——一个只被命名过的项目没有人可接活。
- **命名与存在分离的展示**：`managerLabel` 三态——已绑定且有名显示名字、已绑定无名显示「(未命名)」、未绑定显示「无」或「名字 (未配置)」；总管 `<state>` 的项目列表和 `list_scopes` 都带 ` — manager: X` 后缀，`list_manager_msgs` 空线程时也带上名字而非干巴巴的 `(no messages)`。管理者的系统提示开头自报家门「You are 阿七, the project manager of …」。
- **总管行为指引**：MANAGERS 段说明 `manager: 无` 的含义——Tian 从侧栏项目按钮打开管理者；总管提起管理者时用名字称呼。

**后果**：总管能按名字谈论与定位各项目的管理者，且不会被「有名字但没打开」的项目误导——委派前就被拦截；未命名项目照常工作。局限：名字只是单值字符串，不支持多称呼；「未配置」提示只在 agent 工具面与 state 里出现，UI 列表未加标记；名字与 `channel_sessions` 绑定是两个来源，Tian 改名不影响已存会话。

## D15 · 同一派发者的重复派单折叠，手动停止保留半成品

两个围绕 Run 生命周期的修正：同一 dispatcher 重复发出的相同派单折叠为一个 Run；Tian 可在右侧面板手动停止在跑的 Run。

**背景**：`dispatch` 原本只按 `operationId` 去重——同一次工具调用的重试能挡住，但管理者一轮里发出两次 dispatch（不同 callId）就会并排建出两个完全相同的 Run，浪费算力也让总管难以归因。另一边，Run 一旦开跑没有任何停手入口，只能等它跑完或直接丢弃（连带删 worktree）。

**决定**：

- **内容级去重**：`runs.dispatch` 在建行事务里先查 `operations` 表中的 `dispatch-fold:<operationId>` 折叠记录、再查 `activeRunByPrompt(projectId, prompt, chiefConversationId)`——同一派发者、同一项目、同一份 briefing 且仍有在飞 Run（queued/running/collecting 且 review 未被丢弃）时，直接返回既有 Run 并把该 operationId 记入折叠表，不再建第二个。不同 briefing 或不同派发者照常各建各的；已完结的 Run 之后同名 prompt 可再发；被折叠过的 operationId 在 Run 完结后重试仍解析回原 Run（幂等语义与首调一致）。
- **手动停止**：新命令 `stopRun(id)`（`SERVICE_PROTOCOL` 升至 7）只对 queued/running 且 reviewStatus=pending 的 Run 生效——清超时计时器、abort worker 会话、对 worktree 做一次 `commitAll` 快照（尽力而为，失败记 issue 不撤销停止）、`finishRun` 落 `interrupted` + `Stopped by Tian`、排队一条完成通知、记录 `run.stopped` 事件。worktree、report 路径、review 状态全部保留：可 followUp 续跑、可 land/ship、可 discard。快照先于落 interrupted，保证 diff/land/ship 能看到半成品——否则未提交改动会随 worktree 删除而丢失。
- **collector 不复活**：`execute` 两处闸口新增 `status === 'interrupted'` 检查——queued 时被停的 Run 永不 spawn worker；running 时被停的 Run，abort 后 collector 见到 interrupted 直接退出，不再覆盖状态、不再 collect。
- **UI**：Runs 列表里 queued/running 的 Run 行尾挂红色实心 stop 图标（icon-only 带 `stopRun` aria-label），Run 详情动作条加红色 Stop 按钮；collecting 与已完结 Run 不显示。`interrupted` 且 reviewStatus=pending 的 Run 照常出现在评审区（Land/Ship/Discard 可用）。

**后果**：管理者一轮误发两次相同派单不再产生孪生 Run；Tian 获得「暂停但不销毁」的中间态——比 discard 轻、比干等快，半成品以一次快照提交留在 Run 分支上。局限：去重按 (project, prompt, dispatcher) 完全匹配，换措辞的相似派单仍会并行——这是有意的（不同 briefing 视为不同工作）；停止不收集报告（reportPath 留空），但快照提交使 diff/land/ship 照常可见。
