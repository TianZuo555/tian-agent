# Tian Agent — 产品需求文档（PRD）

版本：v0.4（v0.3 + 项目管理者（Manager）与 Tian 直连派活）
状态：Draft
产品类型：Always-on Personal Agent
平台：macOS 优先；Linux / Windows 后续
技术方向：TypeScript 常驻服务（launchd）+ Pi Durable + Electron/React 客户端 + SQLite（见 [D3](decisions.md#d3--保留-typescript-常驻服务与-electron-客户端)）

术语以 [CONTEXT.md](../CONTEXT.md) 为准。每项需求标注现状：**【已有】** 已实现并有测试覆盖；**【部分】** 有基础但不满足需求；**【缺失】** 尚未开始。标注"建议"的是待确认的设计；标注"待验证"的是尚未在代码中确认的假设。

---

## 1. 产品概述

### 1.1 定位

一个长期在线、有持久记忆、能主动执行、能从经验中学习的个人 Agent。用户委托长期目标，Chief 规划 Task、按需唤醒执行、记录结果、积累经验，必要时请求用户审批。

> 用户管理目标，Agent 管理任务。会话可以结束，但记忆、目标和责任不会消失。

### 1.2 参考产品

| 产品          | 借鉴能力                                                               |
| ------------- | ---------------------------------------------------------------------- |
| OpenClaw      | Gateway、Heartbeat、Cron、分层记忆、Dreaming、Hybrid Retrieval         |
| Hermes Agent  | 轻量核心记忆、Session Search、Background Review、Self-improving Skills |
| OpenAI Dots   | 长期目标、自主研究、跨应用执行、主动通知                               |
| Codex Desktop | 多 Agent、Worktree、任务审查、执行控制                                 |

### 1.3 核心目标

1. **Persistent Memory**：跨会话、进程重启和模型切换保留记忆。
2. **Persistent Goals**：支持持续数天到数月的目标。
3. **Proactive Execution**：通过 Schedule、Event 或手动触发主动执行。
4. **Self-Improvement**：从经验中学习并复用成功流程。
5. **Human Control**：重要操作可审查、干预、撤销或停止。
6. **Runtime Independence**：记忆和目标生命周期与模型、执行 Runtime 解耦。

### 1.4 非目标（初期）

- 不训练或微调模型。
- 不做复杂知识图谱。
- 不自主执行付款、资金交易或其他不可逆高风险操作。
- 第一版不接入所有第三方应用。
- 不让模型持续推理；按需唤醒。
- 不做跨设备同步和远程服务。

---

## 2. 核心对象

| 对象                    | 定义                                                 | 生命周期   | 代码现状                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal                    | 用户希望长期达成或维持的结果                         | 数天至数年 | 【已有】`goals` + Goal 专属会话 + 调度                                                                                                                                                                                      |
| Task                    | 为 Goal（或独立）完成的一件具体工作                  | 分钟至数天 | 【已有】状态机、`owner`、`trigger`、`dedupe_key`、`assignee`/`report_to`（[D5](decisions.md#d5--task-由待办演进而来run-是代码类-task-的执行)、[D12](decisions.md#d12--项目管理者每项目一条持久会话委派即-task-的三级链路)） |
| Run                     | Worker 对代码类 Task 的一次隔离执行                  | 分钟至小时 | 【已有】`runs` + `run_attempts`                                                                                                                                                                                             |
| Conversation（Session） | 一次 Chief / Manager / Worker 的持久 Pi 会话，可归档 | 分钟至长期 | 【已有】Pi Durable，存于 `pi-session.sqlite`；归档标记在 `conversations.archived_at`；角色经 `ConversationInfo.role` 透出                                                                                                   |
| Memory                  | 跨会话保留的事实与经验                               | 长期       | 【已有】SQLite、来源与版本、显式选择的 Core Memory（[D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)）                                                                                        |
| Skill                   | 可复用、可验证的工作流程                             | 长期       | 【部分】`skills` 表、版本与人工审批；语义匹配与模型提取待做                                                                                                                                                                 |

约束：

- 一个 Goal 包含多个 Task；一个 Task 可以有零个或多个 Run，并可跨多个 Conversation。
- Conversation 结束不代表 Task 完成；Run 完成也不代表 Task 完成。
- 归档（Archive）只是把会话从侧栏收起并让出唤醒目标，不删除 transcript、不结束 Task、不改写 History。
- Memory 不承担调度；Goal / Task 存在结构化表中，不以自然语言摘要的形式只存在 Memory 里。
- Skill 独立版本管理和验证。

---

## 3. 系统架构（现状 + 增量）

### 3.1 原则

- **Host-owned State**：只有常驻服务写数据库；前端不是权威来源。【已有】
- **Runtime-agnostic**：Pi 是默认执行器，通过 `WorkerRuntime` 接口接入。【已有】
- **Event-driven**：状态变化写入 Event，并据此驱动通知与后台处理。【已有】`events` 表 + 通知 outbox（[D6](decisions.md#d6--history-是-pi-transcript-的派生索引业务事实统一写入-event)）
- **Local-first**：数据默认在 `~/Library/Application Support/Tian Agent/`。【已有】
- **Recoverable**：重启、失败恢复、升级回滚。【已有】Run、Review、升级；Memory 版本可查但不提供回滚操作
- **Auditable**：关键决策与外部操作保留来源。【已有】`events` 审计、Memory 版本记录、幂等操作记录

### 3.2 进程

| 进程         | 职责                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 常驻服务     | 唯一持有 `tian.db` 与 `pi-session.sqlite`；运行模型、工具、调度、通知、Run |
| Electron App | 桌面客户端，通过 Unix socket 连接服务；退出 App 不停止服务                 |
| Worker       | 在常驻服务内的 Pi Conversation，工作目录为 Run 的 worktree                 |

### 3.3 PRD 模块 ↔ 代码

| PRD 模块              | 现有实现                                                                                        | 增量                              |
| --------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| Agent Gateway         | `service/server.ts`、`openSession` 渠道绑定、Telegram 适配器                                    | 审批按钮（M3）                    |
| Agent Orchestrator    | `worker/service.ts`、`worker/runs.ts`                                                           | —                                 |
| Agent Runtime Adapter | `worker/agents.ts`                                                                              | —                                 |
| Memory Service        | `worker/memory.ts`（SQLite、来源、版本、显式 Core 选择）                                        | 向量检索（M4）                    |
| Memory Worker         | `worker/memory-worker.ts`（候选提取，确定性启发式）                                             | 接入模型提取器待问题 6            |
| Goal Store            | `worker/goals.ts`、`worker/db.ts` 的 `tasks`                                                    | —                                 |
| Project Manager       | `worker/manager-tools.ts`（每项目一条持久会话，详见 [agent-work.md](agent-work.md#项目管理者)） | —                                 |
| Scheduler             | `worker/scheduler.ts`（cron、单事务触发、每日预算）                                             | —                                 |
| Skill Registry        | `worker/skills.ts`                                                                              | 按任务语义匹配、模型提取器（M5+） |
| Approval Service      | 仅 UI 手动 Land/Ship                                                                            | `approvals` + 受控操作（M3）      |
| Frontend              | React 三栏 shell（[D1](decisions.md#d1--三栏-shell导航--对话--上下文)），两侧可折叠             | 审批入口（M3）                    |

---

## 4. 记忆系统

### 4.1 分层

| 层          | PRD 名称          | 本项目实现                                     |
| ----------- | ----------------- | ---------------------------------------------- |
| Core Memory | Core Memory       | 显式选入的有效 Memory，按 Token 预算渲染并注入 |
| History     | Episodic Memory   | Pi transcript 的派生全文索引 + Event 表        |
| Semantic    | Semantic Memory   | M4：由 Memory Worker 合并归纳                  |
| Procedural  | Procedural Memory | M5：Skill                                      |

Goal 与 Task 由 Goal Store 管理，不属于记忆层。

### 4.2 F01 — Core Memory　P0　【已有】

现状：每次请求注入 Global 与当前 Project 的 `wake()` 视图。Core 是由用户或 Chief **明确选入**的少量有效 Memory，默认每 scope 1500 tokens；新记忆默认只可检索，`select` 才常驻，`deselect` 移出不等于遗忘。选入超额原子拒绝并返回用量。Chief 用 `remember` / `revise` / `forget` / `recall` / `select` / `deselect` 读写，取代与删除都保留版本；用户可在 Memory 面板晋升、驳回、选入/移出、修订候选与有效记忆。尚未实现：Goal 级记忆的优先加载（字段已存在但 `wake()` 不按 Goal 过滤）、Prompt 前缀缓存影响的最终结论。

需求：

- 保存用户偏好、长期事实、项目约定；Chief 可新增、取代、删除 Memory；用户可明确要求记住或纠正。
- 作用域：Global、Project；Memory 可选关联到某个 Goal，只在该 Goal 的 Conversation 中优先加载。
- Token 预算可配置。默认：Global 1,500 tokens + Project 1,500 tokens；预算覆盖最终渲染文本（含元数据与用量页脚），超限时拒绝选入而不是静默截断。
- 同一 Conversation 内使用稳定的记忆快照，避免 Prompt 前缀缓存失效。

设计要点（[D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)）：

- 工具：`remember`（替代 `note`，避免与 Markdown Note 混淆）、`revise`（取代）、`forget`（标记删除）、`recall`（关键词 AND + 相关性排序）、`select` / `deselect`（显式 Core 管理）。旧的摘要树 `nap` / `zoom` 已删除。
- 快照：Core Memory 在 Conversation 内按"记忆版本号"缓存，只在新用户轮次且版本变化时刷新；会话中的新写入通过工具返回值告知模型。
- 待验证：Pi 的 `section` 是否位于可缓存的前缀。当前 `state` section 含精确到分钟的 `now`，若位于前缀，每分钟都会使缓存失效；应把易变内容移到前缀之后或用户输入侧。

验收：

- 重启后记忆不变；新 Conversation 加载相关 Core Memory。
- 项目私有 Memory 不出现在其他项目的 Conversation 中。
- 用户纠正后，新 Conversation 使用修订后的事实，被取代的内容不再出现在 Core Memory。

### 4.3 F02 — History 与检索　P0　【已有】

现状：`history_entries` + `history_fts` + `history_cursors` 按游标增量索引 Pi transcript 与 `events`；Chief 用 `search_history` / `read_history` 检索并展开上下文，结果带 `conv:<id>#<entry>` / `event:<id>` 引用。

需求：可按时间、Scope、Conversation、关键词检索以下内容，并定位到原始记录：

- 用户与 Agent 消息、Tool Call 与结果（来自 Pi transcript）
- Task / Run 状态变化、审批决定、用户反馈、外部 Event（来自 Event 表）

设计要点（建议，回答 v0.1 问题 3）：

- Pi 存储仍是 transcript 的唯一来源；`tian.db` 中建立派生的 FTS5 索引，键为 `(conversation_id, entry_id)`，按每个 Conversation 的游标增量同步，启动时补齐。索引可随时丢弃重建。
- 已验证：Node 内置 `node:sqlite` 支持 FTS5 与 `trigram` 分词，中文可检索。trigram 不能匹配少于 3 个字符的查询（例如两字中文词），需要 `LIKE` 兜底。
- 工具：`search_history(query, scope?, since?, until?, limit?)` 返回片段与引用 `conv:<id>#<entry>`；`read_history(ref, offset?, limit?, around?)` 从原始 transcript 分页展开，长工具结果中后段同样可搜、可继续读取。
- 检索流程：确定 Scope 与权限 → FTS → 去重排序 → 按 Token 预算截断 → 附引用。无命中时明确返回"无记录"，不编造。

验收：

- 能找回已结束 Conversation 中的决策，并给出引用。
- History 增长不使新 Conversation 的 Prompt 线性增长。
- 常规本地查询 p95 < 300ms（不含模型）。

### 4.4 F03 — 自动记忆提取　P1（M4）　【部分】

现状：`worker/memory-worker.ts` 在常驻服务内运行后台提取（不占用 Chief 对话回合）。触发时机：Task 完成（`complete_task` / `doneTask`）、会话空闲（watch 到 busy→idle，另有 5 分钟兜底 sweep）、用户纠正（`revise` / `forget` 强制触发，30 秒最小间隔节流，服务关闭/维护时暂停）。流程：Collect（按 Scope 游标增量取 `history_entries`）→ Extract → Classify → Deduplicate（与 `memory_fts` 比对既有记忆）→ Resolve Conflicts（与 active 记忆同 kind 且措辞高度重叠时生成取代候选）→ Persist（单事务，提取器抛异常则回滚且游标不前进）。提取器为可注入接口 `MemoryExtractor`，默认实现是确定性启发式（离线可测）；接 Magpie 模型的位置已预留但未接（问题 6 未决）。

优先：稳定偏好、项目决策、环境配置、问题与解法、有复用价值的经验。不记：闲聊、未证实推测、重复 Tool 输出、外部内容中的指令、临时状态（启发式模式表见 `memory-worker.ts`）。

自动提取的 Memory 可信度为"Agent 推断"，进入 candidate 状态，不直接进入 Core Memory；用户在 Memory 面板 promote（转 active，trust 不变；若候选与 active 记忆矛盾则同事务取代旧记忆）或 dismiss（标记删除且不再重复提取）。

### 4.5 F04 — Consolidation / Dreaming　P1（M4）　【部分】

现状：Light 阶段（候选提取、冲突检测、来源引用）已由 Memory Worker 实现；Consolidate 与 Promote 仍以确定性去重、用户晋升和显式 Core 选择为主，没有后台 Dreaming，也不按频率自动提高权重。摘要树压缩已删除，不再作为 Consolidate 的雏形。

要求：晋升条件可解释；重复出现不能提高不可信内容的权重；保留版本；用户可查看、纠正、删除；失败不损坏已有 Memory。

### 4.6 F05 — Provenance　P0　【已有】

每条 Memory 字段（`memories` 表；来源、可信度、版本与取代关系均已实现）：

| 字段                        | 说明                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`、`scope_id`、`seq`     | `seq` 为 Scope 内不可变序号                                                                    |
| `goal_id`                   | 可选                                                                                           |
| `kind`                      | preference / fact / decision / outcome / environment                                           |
| `content`                   | ≤1000 Unicode 字符                                                                             |
| `source_type`、`source_ref` | user / agent / tool / external / legacy；`source_ref` 精确到 `conv:<id>#<entry>` 或事件、UI 等 |
| `trust_level`、`confidence` | 用户确认 / Agent 推断 / 第三方；`confidence` 仅由候选提取写入，暂不参与选择                    |
| `core`                      | 是否显式选入 Core Memory                                                                       |
| `status`、`superseded_by`   | candidate / active / superseded / deleted                                                      |
| `created_at`、`updated_at`  |                                                                                                |

- `memory_versions` 追加记录每次写入、取代、删除（操作者、原因、前后内容），支持恢复。
- 操作者（谁执行写入）与来源（谁陈述事实）分开；`source: "user"` 需要当前请求确实由真实用户轮次发起的 Runtime 证据，系统唤醒/通知不算，否则降为 `agent_inferred`。
- 外部工具结果和第三方内容不得以高优先级指令的形式进入 Prompt。
- 现有 `LOG.txt` 一次性导入；旧 `TREE/` 只移入 legacy、不再读取；之后单向导出供 Worker 与人阅读。

---

## 5. 目标与任务（Goal Engine）

### 5.1 F06 — Persistent Goals　P0　【已有】

Goal 字段：Objective、Success Criteria、Status、Constraints、Schedule / Trigger、Current State、Next Action、Last Execution，以及 Scope、每日预算，存于 `goals` 表。

状态：`active / paused / blocked / completed / cancelled`。用户可在 Desktop 的 Goals 视图创建、编辑、暂停、恢复、取消；Telegram 侧尚未提供 Goal 管理命令。

已实现的要点：

- 每个 Goal 有一个专属 Chief Conversation，复用渠道绑定：`openSession({ channel: 'goal', externalId: goalId, scopeId })`。Goal 的长期上下文落在 Goal 字段与 Memory 中，而不是无限增长的会话。
- Chief 每次执行后通过 `update_goal` 写回 Current State、Next Action、Last Execution（回答 v0.1 问题 7）；进度以 Success Criteria 清单衡量。

### 5.2 F07 — Task Orchestration　P0　【部分】

现状：Task 已有状态机、`owner`、`trigger` / `trigger_ref`、唯一 `dedupe_key`、`attempts` / `max_attempts` 与 `outcome`；`assignee='manager'` + `report_to` 把有边界的项目工作委派给项目管理者（见 [D12](decisions.md#d12--项目管理者每项目一条持久会话委派即-task-的三级链路)）。Run 具备队列、Attempt、follow-up、超时、恢复、执行与验收分离、幂等派发。尚未实现：失败退避与有限次自动重试（`attempts` 有记录但没有重试调度）、用户的 Pause / Resume / Steer 入口（状态与 `paused` 转换已存在，看板只提供勾选完成）。

需求（[D5](decisions.md#d5--task-由待办演进而来run-是代码类-task-的执行)）：

- 状态：`pending → running → waiting_approval → completed`，以及 `paused / blocked / failed / cancelled`；`outcome` 单独记录（达成 / 未达成 / 无变化）。
- 字段：`goal_id`、`owner`（user / agent）、`trigger`（manual / schedule / event）与 `trigger_ref`、唯一 `dedupe_key`、`attempts` / `max_attempts`、结果摘要。
- 有限次数重试、失败退避；用户可 Steer、Pause、Resume。
- 重启不重复执行同一 Task：创建靠 `dedupe_key`，投递靠 Notification ID，执行靠 Pi Durable 的 `requestId`。
- 代码类 Task 派发 Run（`runs.task_id`）；Run 完成后由 Chief 判断 Task 是否达成。
- MVP 单 Chief 串行处理调度 Task；Run 可并行。

### 5.3 F08 — Scheduler　P0　【已有】

| 触发     | 示例                 | MVP                                         |
| -------- | -------------------- | ------------------------------------------- |
| Schedule | 每天早上检查项目状态 | 是                                          |
| Manual   | 用户要求立即执行     | 是                                          |
| Event    | GitHub 出现新 Issue  | 部分：现有 Inbox 文件投递可作为通用事件入口 |

原则：Scheduler 决定何时唤醒，Chief 决定做什么。

已实现的要点（[D7](decisions.md#d7--调度以一次触发一个事务推进唤醒内容只带-goal-状态与-task)）：

- `schedules`：`goal_id`、cron、时区、`next_fire_at`、`last_fired_at`、`enabled`。
- 到期时在一个事务中：按 `sched:<id>:<fire time>` 创建 Task、写入指向 Goal Conversation 的 Notification、推进 `next_fire_at`。复用现有通知投递与 Durable 去重。
- 休眠或停机期间错过的触发合并为一次，不补跑风暴。
- 唤醒内容只包含 Goal 状态与 Task 描述，不重建完整上下文；Chief 自行检索所需 History。
- 预算：每个 Goal 的每日执行次数、单 Task 最长时间、全局并发；超出则 Task 进入 `blocked` 并通知用户。
- 需要引入 cron 解析依赖（选择时遵守依赖发布时间要求）。
- Heartbeat（周期性自检）P1，基于同一机制实现。

通知去重（场景 C）：`notify_user(goal, fingerprint, text)`；同一 Goal 的相同 fingerprint 在窗口期内只送达一次；`outcome = 无变化` 的 Task 默认不通知。

---

## 6. 自我学习（M5）

### 6.1 F09 — Experience Extraction　P1　【部分】

现状：Run 完成时由 `SkillRegistry.review` 审查执行轨迹（Run 状态、报告、Attempt、Agent 消息）。默认提取器是确定性规则（`RuleBasedExtractor`）：只有成功完成的 Run 且报告含明确的步骤段落（steps/procedure/workflow 标题，或 ≥3 条连续列表项）才产生候选，并带 `run:<id>:attempt:<n>` 来源引用；失败 Run 不产生候选；重复提取同名同文合并来源而不加版本。提取器是可注入接口，模型提取器留待后续接入。

任务完成后审查执行轨迹（Run 报告、Attempt、Agent 消息），提取成功步骤、失败做法、环境限制、可复用命令。普通 History 不等于经验；证据充分的流程才进入 Skill 候选。

### 6.2 F10 — Self-improving Skills　P2　【部分】

现状：`skills` 表按（scope、name、version）多版本并存，状态机 `candidate → approved → retired / superseded`；批准（approve）、停用（retire）、回滚（rollback）只能是用户经 IPC/UI 触发，记入 `events` 审计。dispatch 时按名称/关键词匹配 approved 版本，注入 Worker 指令（`promptPreamble` 同一注入点），并在 `runs.injected_skills` 留痕；渲染前再次校验状态，未批准的候选绝不进入任何 prompt。加载某版本且失败的 Run 会把该版本标记 `verification = failed`（用户决定是否回滚）；回滚把当前版本置 `retired + failed` 并恢复上一个被取代（superseded）的版本为 approved，版本历史完整保留。一次未经验证的成功不得变成全局规则。现有项目设置 `promptPreamble` 仍是最原始的 Procedural Memory，可作为 Skill 的过渡载体。

待办：按任务语义匹配（当前是名称/关键词）、回滚后的自动重验证、与 Memory Worker 的 Dreaming 联动。设计与取舍见 [D10](decisions.md#d10--skill-以人工审批为唯一注入闸门经验提取只产候选)。

---

## 7. 交互与执行控制

### 7.1 F11 — 多入口 Gateway　P0　【部分】

现状：`openSession({channel, externalId, scopeId})` 为渠道创建稳定 Conversation，绑定持久化，所有渠道共享 Scope Memory；外部输入可带 `requestId` 去重。Telegram Bot 适配器已接入（long polling、白名单、`/scope` 切换、回复转发，见 [D8](decisions.md#d8--telegram-适配器long-polling--白名单-chat转发以会话游标恰好一次)）；Inbox 文件邮箱作为通用事件入口。

需求（M3）：

- Telegram Bot 使用 long polling（无需公网入口），按 chat ID 白名单授权，映射为渠道绑定。
- Bot token 存于 `<dataDir>/service.env`（0600）；Keychain 后续。
- Desktop 与 Telegram 共享 Goal、Task、Memory 与审批；同一 Task 只由常驻服务执行，渠道只提交输入（回答 v0.1 问题 4）。

### 7.2 F12 — Task Board　P1　【已有】

现状：Goals 视图内嵌一个跨 Scope 的统一看板，Task Board 已不是独立视图。

- **统一看板**：`tasks` / `goals` / `notices` / `inbox` 一律跨 Scope 加载，Goals 视图在一个页面里依次给出 Open goals、提醒、Tasks 与 Closed goals；每个条目带 Scope 徽标，只有在存在多个 Scope 时才显示（单项目时 Scope 名字不占像素）。
- **分组**：按 pending / running / waiting_approval / blocked / failed / paused / completed 分组，每组带计数与状态色；Goal 归属以 `Goal` 徽标标记，due 日期右对齐。
- **添加行**：Tasks 区块顶部是一条与列表行同构的虚线输入行，提交后立刻落入下方分组；没有 Goal 时给空状态引导，而不是隐藏入口。
- **Goal 卡片**：hover / focus 才显现 Run now / Pause·Resume / Edit / Cancel 操作簇，卡片展开后显示 Success Criteria、Current State、Next Action 与 Schedule。

尚未实现：每个 Task 显示触发原因与下一步、看板层面的筛选与排序（目前只有分组）。现有 Inbox（外部消息邮箱）保持原名与原功能。

### 7.3 F13 — 权限与审批　P0　【部分】

现状：

- Chief 没有 shell 和编码工具；Land / Ship / Discard 只能由用户在 UI 中执行，事实上是人工审批。
- Worker 拥有完整编码工具（含 shell），隔离仅为 Git worktree；"不要 push" 只是指令，没有操作系统级沙箱。
- 幂等：`operations` 表、稳定操作 ID、`requestId`。【已有】

权限分级：

| 级别             | 行为                            | 默认     |
| ---------------- | ------------------------------- | -------- |
| Read             | 检索记忆、读取授权文件          | 允许     |
| Safe Write       | 更新内部状态、写日志、写 Memory | 允许     |
| Controlled Write | Land、Ship、对外发送消息        | 需要审批 |
| Sensitive        | 大量删除、部署生产、支付        | 默认禁止 |

需求（M3）：

- `approvals`：操作类型、对象引用、payload 摘要、请求方、状态（pending / approved / rejected / expired）、决定人、渠道、时间。
- Chief 获得 `request_land` / `request_ship` 等工具：只创建审批，不直接执行；用户在 Desktop 或 Telegram 批准后，由服务调用现有 `runs.land` / `runs.ship`。
- 执行前校验审批状态与 payload 摘要一致；被拒绝的审批不可复用，同一对象重新申请需要新的审批记录。
- MVP 的强制边界是 worktree + 受审批的 Land/Ship；PRD 中 Worker 级别的 Controlled Write 在 MVP 中只能做到"指令 + 事后审查"。建议另行评估：Worker worktree 禁用推送地址、去除推送凭据，或 macOS 沙箱。
- 审批粒度（回答 v0.1 问题 5，建议）：Goal 的 Constraints 声明允许的操作类别；每一次具体的受控操作单独审批。
- 审计：所有 Controlled 及以上操作写入 Event（操作者、Trigger、审批 ID、结果）。

### 7.4 F14 — 会话归档与 shell 折叠　P2　【已有】

现状：会话可以归档与恢复；导航侧栏与上下文右栏都可以整体折叠。两者都是纯视图/路由层面的能力，不改变 transcript。

需求：

- **归档**：`archiveConversation(id, archived)` 写 `conversations.archived_at`，广播 `conversations` 快照；侧栏 Archive 折叠区按归档时间倒序列出，行内按钮在 Archive / Restore 之间切换。归档不是删除：History 检索仍能命中，会话仍可打开并继续对话。
- **唤醒目标**：归档会话不再作为 Scope 级无主通知的默认目标（`latestConversation` 同时排除归档与项目管理者会话）；没有可用会话时才回落。
- **侧栏折叠**：`⌃⌘S` 或标题栏按钮折叠导航，状态存 `localStorage` 并在重启后保留；折叠后标题栏左侧留出红绿灯安全区。
- **右栏折叠**：取消 44px 竖条，开关统一到内容区标题栏右端的按钮（`⌘B`），不占常驻宽度。
- **Settings 浮层**：`⌘,` 打开整页 Settings 时记住来源视图（`navReturn`），关闭后回到原视图而不是固定落到 Chat；Settings 页也有自己的关闭按钮。

已知取舍：折叠状态是本机视图状态，不同步到其他设备；归档只影响侧栏与唤醒目标，Goals / Inbox 看板不按归档状态过滤，History 仍可检索到这些会话。

---

## 8. 存储

`tian.db`（服务独占写入）：

| 表                                                                | 状态   | 说明                                                                                                                                                    |
| ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`、`conversations`、`channel_sessions`                   | 已有   | Scope、会话、归档标记（`conversations.archived_at`）与渠道绑定（[D8](decisions.md#d8--telegram-适配器long-polling--白名单-chat转发以会话游标恰好一次)） |
| `tasks`                                                           | 已有   | Goal、负责方、状态机、去重键（[D5](decisions.md#d5--task-由待办演进而来run-是代码类-task-的执行)）                                                      |
| `runs`、`run_attempts`、`agent_messages`                          | 已有   | `runs.task_id`、`runs.injected_skills`、双向消息线程                                                                                                    |
| `inbox`、`notifications`、`operations`                            | 已有   | 通知 outbox、Goal 提醒去重、幂等操作记录                                                                                                                |
| `memories`、`memory_versions`、`memory_meta`                      | 已有   | [D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)                                                                          |
| `memory_fts`、`history_entries`、`history_fts`、`history_cursors` | 已有   | 派生索引，可重建（[D6](decisions.md#d6--history-是-pi-transcript-的派生索引业务事实统一写入-event)）                                                    |
| `events`                                                          | 已有   | 业务事件与审计                                                                                                                                          |
| `memory_worker_runs`                                              | 已有   | Memory Worker 提取轮次审计（触发原因、候选计数）                                                                                                        |
| `goals`、`schedules`、`user_notices`                              | 已有   | Goal、cron 调度与去重提醒                                                                                                                               |
| `improvements`                                                    | 已有   | 改进日志（[D11](decisions.md#d11--改进日志用户与总管可写系统错误自动指纹化)）                                                                           |
| `telegram_chats`、`telegram_state`、`telegram_forward_cursor`     | 已有   | 渠道映射、轮询 offset 与转发游标（[D8](decisions.md#d8--telegram-适配器long-polling--白名单-chat转发以会话游标恰好一次)）                               |
| `skills`                                                          | 已有   | 多版本、状态机与来源引用（[D10](decisions.md#d10--skill-以人工审批为唯一注入闸门经验提取只产候选)）                                                     |
| `manager_messages`                                                | 已有   | 项目管理者线程（kind / task_id / reply_to / closed_at）（[D12](decisions.md#d12--项目管理者每项目一条持久会话委派即-task-的三级链路)）                  |
| `approvals`                                                       | 未合并 | 受控操作审批（`m3-approvals` 分支）                                                                                                                     |

`pi-session.sqlite`：Pi Durable 会话与 transcript，History 的唯一来源。

文件：Notes（Markdown，可读写）、Inbox、Run 报告；Memory 导出（只读，单向）。

每次 schema 变化提升 `DATABASE_VERSION`，并由现有升级事务覆盖备份与回滚。

---

## 9. MVP 范围与里程碑

MVP 验证三件事：跨会话的持久记忆；没有新消息时自动执行；重启后可靠恢复目标、任务和待审批状态。

### M1 — Memory Foundation　【已完成】

- `memories` / `memory_versions` / `memory_meta` + FTS；`LOG.txt` 导入；单向导出。
- Chief 工具：`remember` / `revise` / `forget` / `recall`（关键词 AND）/ `select` / `deselect`。
- Core Memory 按 Token 预算渲染，Conversation 内使用快照。
- `events` 表；History 派生索引与 `search_history` / `read_history`。
- Memory UI：显示来源、状态、版本，支持晋升、驳回与修订。

遗留：`state` section 含精确到分钟的 `now`，尚未确认它是否落在可缓存的前缀内。

### M2 — Persistent Agent　【已完成】

- `goals`、`tasks` 演进、`runs.task_id`。
- `schedules` 与调度器；Goal Conversation；`update_goal`、`notify_user` 及去重。
- 每日预算与超时已实现；失败退避与自动重试未实现。
- UI：Goal 列表与详情（创建、暂停、恢复、取消、编辑）与 Task Board（现已合并进 Goals 视图的统一看板，见 F12）。

### M3 — Always-on UX　【部分】

- 已完成：Telegram 适配器（消息、`/scope`、`/status`、回复转发）；Task Board 位于 Goals 视图；跨 Scope 统一看板（Tasks / Goals / 提醒 / Inbox 带 Scope 徽标）；会话归档与恢复；侧栏与右栏折叠。
- 待做：`approvals` 与受控操作工具（设计与实现已在 `m3-approvals` 分支）、Desktop 审批入口、Telegram 审批按钮。
- 场景 A–F 的自动化测试：A、B、C、D、E 已有覆盖，F 待审批落地后补齐。

### M4 / M5（MVP 之后）

- M4：Memory Worker（候选提取已实现，模型提取器待问题 6）、Dreaming、向量 + 全文混合检索。
- M5：Experience Review、Skill（已实现）、多 Agent 协作。

MVP 暂不实现：自动 Dreaming、向量检索、多 Agent 自主协作、复杂事件订阅、跨设备同步、自主财务操作。

---

## 10. 验收场景

每个场景对应 `pnpm test` 中的自动化测试（临时数据库、真实临时 Git 仓库、可控 Worker，不调用模型）。

| 场景 | 描述                         | 预期                                                    | 当前                                                                |
| ---- | ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| A    | 告知长期偏好，结束会话并重启 | 新 Conversation 的 Core Memory 包含该偏好               | 已有（`memory.test.ts`）                                            |
| B    | 询问一周前的开发决定         | `search_history` 命中原始记录并返回引用                 | 已有（`history.test.ts`）                                           |
| C    | 每天自动检查 GitHub 项目     | 按 Schedule 生成 Task、记录结果；无变化不重复通知       | 已有（`goals.test.ts`：单事务触发、错过合并、每日预算与通知去重）   |
| D    | 执行中应用崩溃               | 重启后恢复 Task 与 Run；已执行的外部操作不盲目重试      | 已有（`goals.test.ts` 触发重放、`service.test.ts` Run 恢复）        |
| E    | 用户纠正旧偏好               | 旧 Memory 被取代并保留版本，Core Memory 不再包含旧内容  | 已有（`memory.test.ts`）                                            |
| F    | Agent 想推送代码             | 审批前不执行；审批持久化；拒绝后无法绕过                | 部分（仅 UI 手动 Ship；approvals 在 `m3-approvals` 分支）           |
| G    | 用户归档一个已结束的会话     | 侧栏收起但 History 仍可检索；Scope 级唤醒不再落在它上面 | 已有（`service.test.ts` 归档与恢复、`latestConversation` 排除归档） |
| H    | 用户折叠侧栏后重启 App       | 折叠状态保留，标题栏给红绿灯留位                        | 部分（`state.test.ts` 覆盖存储初始化；折叠布局靠人工验证）          |
| I    | 总管委派或直接给管理者派活   | 委派 Task 收口后回报发起总管；直连派的 Task 静默收口    | 已有（`manager.test.ts` 委派链路、Tian 轮次守卫与静默收口）         |

---

## 11. 非功能需求

| 维度     | 目标                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 持久性   | 已确认的写入在正常重启和升级后不丢失（WAL + 升级备份）【已有】                                                                    |
| 故障恢复 | 恢复未完成 Task，核对外部操作状态                                                                                                 |
| 检索     | 本地常规查询 p95 < 300ms，不含模型                                                                                                |
| 性能     | 后台处理在常驻服务内，不阻塞 renderer【已有】                                                                                     |
| 成本     | Memory Worker 等后台调用可配置模型与预算；Magpie 不回传单价，成本按 Token 计（[D2](decisions.md#d2--模型统一走本地-magpie-网关)） |
| 隐私     | 本地优先、按 Scope 隔离、明确外部数据传输边界                                                                                     |
| 安全     | 最小权限、来源追踪、审批、审计、Prompt Injection 防护                                                                             |
| 可观测性 | 记录 Trigger、检索命中、Task 结果、Token 用量（已有按 Scope 的 Token 统计）                                                       |

性能目标为初步指标，需在真实数据量与硬件上验证。

---

## 12. 产品指标

- **Memory Recall Accuracy**：需要历史时正确检索并使用相关事实的比例。
- **Memory Contradiction Rate**：使用过期或矛盾 Memory 的频率（可由被取代 Memory 出现在回答中的次数衡量）。
- **Task Recovery Success Rate**：重启后正确恢复、继续或安全停止 Task 的比例。
- **Autonomous Task Success Rate**：无需人工纠正达到 Success Criteria 的比例。
- **Unnecessary Action Rate**：重复执行、重复通知、无意义工具调用的频率。
- **Tokens per Completed Task**：完成一个成功 Task 的 Token 消耗（暂无金额成本）。

---

## 13. 设计问题

| #   | 问题                               | 结论                                                                                                                             |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Always-on Runtime 是否独立后台进程 | **已决**：是，launchd 常驻服务（已实现）                                                                                         |
| 2   | Core Memory 预算与更新策略         | **建议**：Global / Project 各 1,500 tokens，显式选择 + 原子超限拒绝，会话内快照                                                  |
| 3   | History 是否复用 Pi 原生存储       | **建议**：Pi 为唯一来源，`tian.db` 建可重建的派生 FTS 索引                                                                       |
| 4   | 多 Gateway 并发执行同一任务        | **建议**：只有常驻服务执行，渠道只提交；`dedupe_key` + Durable 去重                                                              |
| 5   | 权限按 Agent / Goal / Task 授权    | **建议**：Goal 声明允许的操作类别，每次受控操作单独审批                                                                          |
| 6   | Memory Worker 是否用廉价模型       | **未决**（M4）：通过 Magpie 可单独配置模型；F03 现用确定性启发式提取器，`MemoryExtractor` 接口已预留接入点，接入与否待此问题决定 |
| 7   | Goal 如何确定下一步与衡量进展      | **建议**：Chief 每次执行后写回 Current State / Next Action；按 Success Criteria 清单衡量                                         |
| 8   | Worker 的写权限如何真正受限        | **未决**：MVP 以 worktree + 审批 Land/Ship 为边界；沙箱或去除推送凭据另行评估                                                    |

问题 2–5、7 已分别落到 [D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)、[D6](decisions.md#d6--history-是-pi-transcript-的派生索引业务事实统一写入-event)、[D5](decisions.md#d5--task-由待办演进而来run-是代码类-task-的执行)、[D7](decisions.md#d7--调度以一次触发一个事务推进唤醒内容只带-goal-状态与-task)；问题 1 见 [D3](decisions.md#d3--保留-typescript-常驻服务与-electron-客户端)。设计决策集中在 [decisions.md](decisions.md)。

---

## 14. 产品原则

- **Memory ≠ Context**：长期记忆不等于无限增长的上下文。
- **Goal ≠ Conversation**：会话可以结束，目标必须持续存在。
- **Activity ≠ Progress**：执行了工具不代表 Task 有进展；Run 完成不代表 Task 达成。
- **Experience ≠ Verified Skill**：经验未经验证不能成为执行规则。
- **Autonomy ≠ Unlimited Authority**：Agent 可以主动规划，执行权限受用户控制。

目标：从需要持续下指令的助手，演进为能长期承担责任、积累经验、可靠执行并接受监督的个人 Agent。
