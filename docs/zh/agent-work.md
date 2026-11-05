# 目标、任务与 Run

[English](../agent-work.md) | **简体中文**

用户管理目标，Agent 管理任务。Goal 是长期跟进的结果；Task 是一件具体工作；Run 是工兵为代码类 Task 在隔离 worktree 中的一次执行。

## Goal

Goal 属于一个 scope，带 objective、success criteria、constraints、current state、next action、last execution 与每日预算，存于 `goals` 表。总管用 `create_goal` / `update_goal` / `list_goals` 维护；用户在 Goals 视图创建、编辑、暂停、恢复或取消。

- **Goal 会话**：每个 Goal 通过 `openSession({ channel: 'goal', externalId: goalId, scopeId: 'global' })` 获得一条专属总管会话。会话始终位于 Global Scope，与项目有关的 Goal 也一样：Goal 保留项目关联，项目工作经 `delegate` 下发（[memory.md](memory.md#会话边界)）。跨重启稳定，唤醒内容只投递到这条会话。
- **用户提醒**：`notify_user(goal, fingerprint, text)` 把需要用户知道或决定的事写入 `user_notices`；同一 Goal 相同 fingerprint 在 24 小时窗口内只送达一次，`outcome = no_change` 的结果不通知。Goals 视图展示提醒列表；Telegram 投递留待后续。

## Task

Task 状态机：`pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`。转换集中在 `db.ts` 一处校验，非法转换抛错。结果单独记 `outcome`（achieved / not_achieved / no_change）与 summary。`trigger`（manual / schedule / event）与唯一 `dedupe_key` 记录来源，重启或重复触发不会生成第二个 Task。

## 调度

`schedules` 表保存 cron、时区与持久化的 `next_fire_at`；服务内定时器睡到最早的触发点（上限 60 秒，不阻塞退出）。每次触发在一个事务内完成：

1. 在 Global Scope 创建 Task（`dedupe_key = sched:<schedule>:<触发时间>`）；Goal 自己的 Task 是总管的工作，Goal 涉及项目时也一样。
2. 向 Goal 会话投递通知（内容只含 Goal 状态与本次 Task，不重建历史）。
3. 从当下推进 `next_fire_at`——停机期间错过的触发合并为一次，不补跑。

每个 Goal 的 `max_runs_per_day` 限制每日执行次数；超出后本次唤醒生成 `blocked` Task 并留下去重提醒，不默默丢弃。

代码类任务由 `dispatch` 发起，可选 `task` 参数把 Run 关联到 Task（`runs.task_id`）。Run 完成不等于 Task 完成：派发它的项目管理者依据结果调用 `complete_task` / `fail_task` 收口并向总管汇报，再由总管 `update_goal` 写回状态。

## 项目管理者

项目管理者是介于总管与工兵之间的项目级角色：每项目恰好一条持久会话（`channel_sessions` 中 `channel = 'manager'`、`external_id = project_id`），`addProject` 时随项目创建（管理者名字必填），服务启动时为旧项目补建。除总管委派外，Tian 也能经 `openManager(projectId)`（侧栏的项目管理者按钮）直接打开这条会话派活。

- **Tian 直连**：本轮输入的 `kind` 为 `'user'`（区别于唤醒用的 `'system.notification'` 与 `'worker.input'`）即为 Tian 轮次——他在此派的工作成为管理者自己的 Task（`add_task` → `start_task` → `complete_task` / `fail_task`），静默收口，不通知总管；`ask_chief` 被挡下并提示在答复里直接问 Tian；`report_chief` 只允许带一个 `assignee='manager'` 的委派 Task id（仍按该 Task 的 `report_to` 上报），否则返回提示语。这些守卫落在工具实现上：Tian 轮次里两个工具都不写 `manager_messages`、不唤醒总管。
- **委派即 Task**：总管 `delegate(project, title, briefing, goal?)` 在一个事务内创建 `assignee='manager'`、`report_to=发起总管会话` 的 Task 与一条 `kind='delegation'` 的消息，然后唤醒管理者。管理者 `start_task` → `dispatch` → `complete_task` / `fail_task` 收口——关闭委派 Task 自动把结果通知回 `report_to` 的总管（Tian 轮次中亦然：归属仍属委派的 Task 照常上报）；总管对委派 Task 的 `start_task` / `complete_task` / `fail_task` 被拒绝，Goal 始终归总管。
- **上行与问答**：管理者 `report_chief(text, task?)` 汇报，`ask_chief(question, task?, wait_seconds?)` 写 `kind='question'` 行并阻塞等待匹配 `reply_to` 的 `kind='answer'`；无关消息不会被当成答复，超时在事务内「关闭 + 复查」竞态答案。总管用 `send_manager_msg(project, body, reply_to?, task?)` 答复或发消息：仍在等待的答覆由 `ask_chief` 直接返回不唤醒，迟到答覆补一次唤醒，普通消息每次唤醒。上行通知按 Task 路由——本 Task 的 `report_to`、其次项目最新委派 Task 的 `report_to`、再回落 Global 最新的总管会话（项目 scope 里只有管理者，不能作回落目标）。
- **再分发**：管理者 `dispatch(prompt, task?)` 把代码工作派给工兵，`chief_conversation_id` 指向管理者会话——工兵的 `ask_manager` 与 Run 完成通知都回到管理者，由管理者收口 Task 并 `report_chief`。
- **边界**：管理者工具锁定本项目 scope——任务、notes、history 与 Run 只许本项目，dispatch 只许本项目的 Task；它是本项目记忆与 notes 的唯一 Agent 写入者，Global 记忆中只能看到注入的 Global Core，且只读（[D18](decisions.md#d18--记忆按角色归属总管管-global管理者管项目)）；没有 shell / 编码工具。

### 派发归属

只有项目的管理者能在该项目中派发工兵，管理者是它派发的每个 Run 的上级。所有编码工作走同一条路：总管 `delegate` → 管理者 → `dispatch` → 工兵。监督会话不是管理者会话的派发会被服务拒绝。

- 理由：派发简报是工兵的唯一输入（[memory.md](memory.md#工兵)），有用的简报需要项目记忆，只有管理者有。Run 的结果也变成项目经验，由管理者记录。
- 总管没有 `dispatch`、`send_run_msg`、`stop_run` 等 Run 工具。它经管理者汇报、Run 检查工具与 UI 的 Run 面板跟进编码工作，需要干预时经 `send_manager_msg` 传达。
- 工兵消息工具跟随上级：`ask_manager` / `tell_manager` / `check_msgs`。Run 仍用 `chief_conversation_id` 记上级，但现在存的总是管理者会话；`agent_messages` 的 sender 是 `manager` 与 `worker`。
- 代价：小改动多一跳（先委派再派发），延迟与 token 都增加。

## Run 生命周期

```text
执行状态（status）：
dispatch → queued → running → collecting → done / failed
            │         │
            └── stop ─┴──→ interrupted

验收状态（reviewStatus，独立记录）：
pending → landing → landed
       ↘ shipping → shipped
       ↘ discarding → discarded
```

- Git 项目必须成功创建 worktree，隔离失败终止派发并保留记录；非 Git 项目默认拒绝，明确开启 `allowInPlace` 后才可修改原目录。
- Run 保存派发时的目录、base branch、执行模式及截止时间。
- follow-up 每轮有独立 attempt、输入、结果和报告，复用工兵会话与 worktree。
- 派发用稳定操作 ID，各轮输入用稳定 `requestId`；成功依据 Durable submission 结果，空闲不代表成功，Git 提交失败会进入失败状态。
- 同一 Run 的状态转换与验收串行；discard 先停止工兵，collector 不覆盖其结果。
- 全局上限约束同时进行模型工作的 worker attempt 数（`MAX_ACTIVE_ATTEMPTS`，默认 3）。超出的 attempt 按派发顺序在 Run 锁外等待空位，因此 `stop` 与 `discard` 在等待时仍可用。等待过的 Run 保留原时限，但计时从 attempt 真正开始时算起。重启前已经开始的 attempt 直接占用槽位，不进入等待队列。
- Git 子进程关闭交互提示（`GIT_TERMINAL_PROMPT=0`）并在 10 分钟后超时；commit 或 merge 的 hook 可能较慢。`gh` 调用保留 120 秒上限并设置 `GH_PROMPT_DISABLED=1`。
- Land 合入保存的 base branch，要求主 checkout 位于该分支且无已跟踪文件的未提交修改；land 后不能 follow-up。
- Ship 推送分支，再查询或创建 PR，重复请求复用 PR URL。
- 已开始的 land/ship/discard 先入库，启动时继续或核对。

## 管理者 ⇄ 工兵消息

每个 Run 在它的监督管理者与工兵之间有一条持久消息线程（`agent_messages` 表），双向可达：

- 工兵 `ask_manager(question, wait_seconds?)`：提问并阻塞等待答复。问题经通知管道立即唤醒管理者（不等 Run 结束），管理者用 `send_run_msg` 回复；等待窗口内无答复则工兵自行判断并在报告中记录。Run 被 discard 时提问立即返回并要求停止。
- 工兵 `tell_manager(text)`：发送不等待的进度通知。
- 工兵 `check_msgs`：读取管理者发来的未读消息（答复之外的主动指令）。
- 管理者 `send_run_msg(run, body)`：回复提问中的工兵，或对运行中的 Run 主动下达指令；`list_run_msgs(run)` 查看完整线程。

## 进度与中止

项目管理者读取 Run 的实时进度并中止本项目的 attempt；总管只能读进度、报告、diff 与消息线程，不能停止 Run 或给它发消息。两者都不是 shell 权限，也不越过各自的 scope 边界。

- **`run_progress(id)`**：返回状态、attempt、已用时间与截止时间（无超时时明说 `no deadline`）、工兵最后一段输出、最近 5 次工具调用（工具名 + 截断后的参数）。数据来自 `runs` 行与工兵会话的 `entries()`，只读；discarded 的 Run 只给行内信息。这是「它卡住了还是在干活」的判断依据，也是总管回答「进展如何」的唯一正当来源。
- **`stop_run(id, reason?)`**：在 Run 锁内把 `status` 置为 `interrupted` 并写入 `error` 与 `finished_at`，记录 attempt 与 `run.stopped` 事件，然后 abort 工兵会话。**worktree 与分支保留**，`reviewStatus` 仍是 `pending`，因此之后仍可 `read_run_diff`、land、或 follow-up 开新一轮；它不是 discard，不删任何东西。
- **不覆盖**：abort 让 collector 的 `submission.wait()` 返回，但 collector 在锁内复查 `status === 'interrupted'` 后直接返回，不会把结果写成 done/failed。`execute()` 只在 `reviewStatus === 'pending'` 时重启，因此中断的 attempt 不会被恢复流程续跑。
- **边界**：`stop_run` 与 `send_run_msg` 必须落在本项目，越界报 `belongs to another project`。总管没有这两个工具，需要干预时经 `send_manager_msg` 传达给管理者。
- **经验审查**：中止也算一次 ending——`stop()` 在 abort 后读该 attempt 留下的报告，以 `stopped` 标记调用 `reviewExperience`。报告里有明确步骤段落仍可产候选（描述注明 stopped early 与原因），但**不会**把注入的 skill 标 `verification = failed`：主动收回不等于流程失效。

消息 ID 与通知 ID 均由调用派生，Durable 重放不产生重复消息；已读状态持久化。工兵被要求优先自行决策，只在破坏性操作、缺失凭据或根本性歧义时提问。

报告从 `TIAN_REPORT.md` 收集到 `<project root>/.tian/runs/`，每轮独立保留，报告不进入代码提交。

## 工兵执行器

工兵的执行器可配置。Pi Durable 内置且始终启用；Codex 是第一个外部执行器，其他编码 Agent CLI 以同样形状的适配器接入。角色规则不随执行器改变：工兵没有记忆，输入只有简报与 worktree，上级是项目管理者。

执行器与模型通过 Intent 选择：

1. **Settings → 工兵**：用户设置全局并发上限、按执行器的可选上限，并定义 Intent。Intent 把一个名字映射到执行器、模型、思考等级与用途说明，例如 `review` → Pi 上的 `magpie:sol-6.1`。
2. **项目默认**：每个项目有一个 `default_intent`（schema v10 起取代 `projects.agent_kind`）。为空 = 内置默认：Pi 执行器 + 全局默认模型。
3. **派发**：管理者为每个 Run 用两种互斥方式之一选择：一个 `intent`，或明确的 `runtime` + `model`（+ `thinking_level`）。两者同时给出报错；都不给则用项目默认 Intent。明确选择必须使用已启用的执行器；Pi 模型按 provider 目录校验（D13），外部模型原样传递不校验（D21）。管理者的 `<state>` 列出 Intent 名称、解析目标与用途说明。

Run 在创建时保存解析后的执行器、模型与思考等级，之后修改 Intent 不影响已有的 Run。Run 的执行器固定：follow-up Attempt 与重启续接都沿用它，因为 resume 依赖执行器的 session id。换执行器需要新 Run。

Pi Durable 工兵保持现有契约：运行中消息（`ask_manager`、`tell_manager`、`check_msgs`）、durable replay、从会话条目读取进度、同一会话内的 follow-up Attempt。

### 外部执行器

Codex 是第一个外部执行器（`src/worker/codex.ts`）。外部工兵遵守“一次性执行 + resume 续接”的基线契约：

- **启动**：适配器在 Run 的 worktree 中以无交互模式运行 `codex exec --json --sandbox <模式> --skip-git-repo-check <prompt>`，简报作为 prompt。exec 旗标放在 `resume` 之前，因为 `codex exec resume` 不接受 `--sandbox`。
- **进度**：适配器读取 JSONL 事件流（`thread.started`、`item.started`、`item.completed`、`turn.completed`），供 `run_progress` 使用；最新的工具调用存在 `runs.external_last_call`；上报的 token 用量记为 `run.usage` 事件。
- **结果**：进程退出即 attempt 结束。最终 agent 消息或 `TIAN_REPORT.md` 作为报告。Agent 运行中不提问，把未决问题写进报告。
- **中止**：`stop_run` 杀整个进程组。worktree 保留，与 Pi 工兵相同。
- **跟进**：follow-up Attempt 运行 `codex exec … resume <session> <prompt>`；session id 存在 `runs.external_session`。
- **服务重启**：外部工兵是服务的子进程，不是 durable 的；崩溃、手动重启或机器重启都会杀掉它，服务停止时也会杀掉它的进程组（升级会先等空闲，见 [D9](decisions.md)）。在 codex 报告 session 之前，适配器先把已启动的 Attempt 记入 `runs.external_attempt`。服务启动后在同一个 Attempt 内自动续接该外部会话，并带以下护栏：
  - 续接前，适配器先杀掉硬崩溃后仍存活的进程组（`runs.external_pid`，先核对进程命令），再给 worktree 做快照提交，重启前的工作保持可查。
  - 续接 prompt 说明进程被杀，给出最后记录的工具调用（从 `runs.external_last_call` 读取，所以重启后仍在），并告诉 Agent 这次调用可能没有完成：先检查 worktree 状态，未经检查不要重复有副作用的操作。
  - 通过通知 outbox 给管理者发一条不阻塞的通知；续接不等它。
  - Attempt 保留原时限，并立即占用并发槽位，不排队。
  - 每个 Attempt 最多自动续接一次（`runs.auto_resumed` 记录）。同一 Attempt 内第二次被杀、没有 session id、或续接失败，Attempt 结束为 `interrupted`（worktree 保留，与 `stop_run` 相同）并通知管理者。
- **启用检测**：外部执行器默认关闭。Settings → 工兵 探测 `codex --version` 与 `codex login status`，探测通过后服务才会启用该执行器；登录过期显示「需要登录」，不是笼统失败。
- **安全边界**：子进程只继承环境变量白名单（PATH、HOME、`CODEX_*`——服务 socket 路径与 provider 密钥留在服务侧）。项目沙箱开启（默认）时，spawn argv 改写到按 Run 生成的 Seatbelt profile 下，CLI 自带沙箱放松为 `danger-full-access`——Tian profile 是唯一边界。该 profile 中 `$CODEX_HOME` 可写（会话、日志、登录刷新、app-server socket），但其中的 `config.toml`、`AGENTS.md`、`AGENTS.override.md` 只读；项目沙箱关闭时 CLI 的 `--sandbox workspace-write` 保留为过渡底线（[D22](decisions.md#d22--统一的-seatbelt-工兵沙箱)、[todo-worker-sandbox.md](todo-worker-sandbox.md)）。

并发有两层限制，都在 Settings → 工兵 实时可调：

1. **全局上限**（默认 3）：计入所有执行器的工兵 attempt。它保护本机资源（CPU、内存、构建与测试）。
2. **执行器上限**：可选，默认不设。它保护外部额度与速率限制（例如 Cursor 设为 2）。

attempt 必须先拿到所属执行器的槽位、再拿到全局槽位才能开始。队列不是严格先进先出：只因执行器槽位满而等待的 attempt，不阻塞后面执行器有空位的 attempt。总管与管理者的轮次不设上限；它们是模型调用，多个管理者可以同时思考与派发。

经每个 Run 的 MCP server 实现运行中消息，是以后适配器可声明的可选能力，不属于基线。原因：基线只依赖无交互执行、结构化输出与 resume，主流 Agent CLI 都具备，新接一种执行器的成本低。代价：外部工兵遇到阻塞性歧义时不能停下来问，一问一答要花一整个 Attempt。
