# 目标、任务与 Run

[English](../agent-work.md) | **简体中文**

用户管理目标，Agent 管理任务。Goal 是长期跟进的结果；Task 是一件具体工作；Run 是工兵为代码类 Task 在隔离 worktree 中的一次执行。

## Goal

Goal 属于一个 scope，带 objective、success criteria、constraints、current state、next action、last execution 与每日预算，存于 `goals` 表。总管用 `create_goal` / `update_goal` / `list_goals` 维护；用户在 Goals 视图创建、编辑、暂停、恢复或取消。

- **Goal 会话**：每个 Goal 通过 `openSession({ channel: 'goal', externalId: goalId, scopeId })` 获得一条专属总管会话，跨重启稳定，唤醒内容只投递到这条会话。提案：Goal 会话始终位于 Global Scope，与项目有关的 Goal 也一样；Goal 保留项目关联，项目工作经 `delegate` 下发（[memory.md](memory.md#会话边界提案)）。
- **用户提醒**：`notify_user(goal, fingerprint, text)` 把需要用户知道或决定的事写入 `user_notices`；同一 Goal 相同 fingerprint 在 24 小时窗口内只送达一次，`outcome = no_change` 的结果不通知。Goals 视图展示提醒列表；Telegram 投递留待后续。

## Task

Task 状态机：`pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`。转换集中在 `db.ts` 一处校验，非法转换抛错。结果单独记 `outcome`（achieved / not_achieved / no_change）与 summary。`trigger`（manual / schedule / event）与唯一 `dedupe_key` 记录来源，重启或重复触发不会生成第二个 Task。

## 调度

`schedules` 表保存 cron、时区与持久化的 `next_fire_at`；服务内定时器睡到最早的触发点（上限 60 秒，不阻塞退出）。每次触发在一个事务内完成：

1. 创建 Task（`dedupe_key = sched:<schedule>:<触发时间>`）。
2. 向 Goal 会话投递通知（内容只含 Goal 状态与本次 Task，不重建历史）。
3. 从当下推进 `next_fire_at`——停机期间错过的触发合并为一次，不补跑。

每个 Goal 的 `max_runs_per_day` 限制每日执行次数；超出后本次唤醒生成 `blocked` Task 并留下去重提醒，不默默丢弃。

代码类任务由 `dispatch` 发起，可选 `task` 参数把 Run 关联到 Task（`runs.task_id`）。Run 完成不等于 Task 完成：派发方（总管或项目管理者）依据结果调用 `complete_task` / `fail_task` 收口，再 `update_goal` 写回状态。

## 项目管理者

项目管理者是介于总管与工兵之间的项目级角色：每项目恰好一条持久会话（`channel_sessions` 中 `channel = 'manager'`、`external_id = project_id`），`addProject` 时随项目创建（管理者名字必填），服务启动时为旧项目补建。除总管委派外，Tian 也能经 `openManager(projectId)`（侧栏的项目管理者按钮）直接打开这条会话派活。

- **Tian 直连**：本轮输入的 `kind` 为 `'user'`（区别于唤醒用的 `'system.notification'` 与 `'worker.input'`）即为 Tian 轮次——他在此派的工作成为管理者自己的 Task（`add_task` → `start_task` → `complete_task` / `fail_task`），静默收口，不通知总管；`ask_chief` 被挡下并提示在答复里直接问 Tian；`report_chief` 只允许带一个 `assignee='manager'` 的委派 Task id（仍按该 Task 的 `report_to` 上报），否则返回提示语。这些守卫落在工具实现上：Tian 轮次里两个工具都不写 `manager_messages`、不唤醒总管。
- **委派即 Task**：总管 `delegate(project, title, briefing, goal?)` 在一个事务内创建 `assignee='manager'`、`report_to=发起总管会话` 的 Task 与一条 `kind='delegation'` 的消息，然后唤醒管理者。管理者 `start_task` → `dispatch` → `complete_task` / `fail_task` 收口——关闭委派 Task 自动把结果通知回 `report_to` 的总管（Tian 轮次中亦然：归属仍属委派的 Task 照常上报）；总管对委派 Task 的 `start_task` / `complete_task` / `fail_task` 被拒绝，Goal 始终归总管。
- **上行与问答**：管理者 `report_chief(text, task?)` 汇报，`ask_chief(question, task?, wait_seconds?)` 写 `kind='question'` 行并阻塞等待匹配 `reply_to` 的 `kind='answer'`；无关消息不会被当成答复，超时在事务内「关闭 + 复查」竞态答案。总管用 `send_manager_msg(project, body, reply_to?, task?)` 答复或发消息：仍在等待的答覆由 `ask_chief` 直接返回不唤醒，迟到答覆补一次唤醒，普通消息每次唤醒。上行通知按 Task 路由——本 Task 的 `report_to`、其次项目最新委派 Task 的 `report_to`、再回落 scope 最新非 Manager 会话。
- **再分发**：管理者 `dispatch(prompt, task?)` 把代码工作派给工兵，`chief_conversation_id` 指向管理者会话——工兵的 `ask_chief` 与 Run 完成通知都回到管理者，由管理者收口 Task 并 `report_chief`。
- **边界**：管理者工具锁定本项目 scope——任务、notes、history 与 Run 只许本项目，dispatch 只许本项目的 Task；它是本项目记忆与 notes 的唯一 Agent 写入者，Global 记忆只读（[D18](decisions.md#d18--记忆按角色归属总管管-global管理者管项目)）；没有 shell / 编码工具；总管 `send_run_msg` 拒绝管理者名下的 Run。

### 派发归属（提案）

只有项目的管理者能在该项目中派发工兵，管理者是它派发的每个 Run 的上级。所有编码工作走同一条路：总管 `delegate` → 管理者 → `dispatch` → 工兵。

- 原因：派发简报是工兵唯一的输入（[memory.md](memory.md#工兵)），写好简报需要项目记忆，而项目记忆只在管理者那里。Run 的结果也是项目经验，由管理者记录。
- 总管去掉 `dispatch`，也不能对项目 Run 使用 `send_run_msg` 与 `stop_run`。总管通过管理者的汇报与 UI 的 Run 面板了解代码工作。
- 工兵的消息工具跟随上级改名：`ask_chief` / `tell_chief` 改为 `ask_manager` / `tell_manager`。
- 代价：小改动也要多一跳（先委派，再派发），延迟与 token 增加。

代码缺口：总管有 `dispatch`（`tools.ts`），Run 用 `chief_conversation_id` 记录派发者。按此边界，去掉总管的工具，工兵工具改名，派发者字段视为管理者会话。

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

## 总管 ⇄ 工兵消息

每个 Run 有一条持久消息线程（`agent_messages` 表），双向可达：

- 工兵 `ask_chief(question, wait_seconds?)`：提问并阻塞等待答复。问题经通知管道立即唤醒总管（不等 Run 结束），总管用 `send_run_msg` 回复；等待窗口内无答复则工兵自行判断并在报告中记录。Run 被 discard 时提问立即返回并要求停止。
- 工兵 `tell_chief(text)`：发送不等待的进度通知。
- 工兵 `check_msgs`：读取总管发来的未读消息（答复之外的主动指令）。
- 总管 `send_run_msg(run, body)`：回复提问中的工兵，或对运行中的 Run 主动下达指令；`list_run_msgs(run)` 查看完整线程。

## 进度与中止

总管与项目管理者都能读取 Run 的实时进度并中止当前 attempt——两者都不是 shell 权限，也不越过各自的 scope 边界。

- **`run_progress(id)`**：返回状态、attempt、已用时间与截止时间（无超时时明说 `no deadline`）、工兵最后一段输出、最近 5 次工具调用（工具名 + 截断后的参数）。数据来自 `runs` 行与工兵会话的 `entries()`，只读；discarded 的 Run 只给行内信息。这是「它卡住了还是在干活」的判断依据，也是总管回答「进展如何」的唯一正当来源。
- **`stop_run(id, reason?)`**：在 Run 锁内把 `status` 置为 `interrupted` 并写入 `error` 与 `finished_at`，记录 attempt 与 `run.stopped` 事件，然后 abort 工兵会话。**worktree 与分支保留**，`reviewStatus` 仍是 `pending`，因此之后仍可 `read_run_diff`、land、或 follow-up 开新一轮；它不是 discard，不删任何东西。
- **不覆盖**：abort 让 collector 的 `submission.wait()` 返回，但 collector 在锁内复查 `status === 'interrupted'` 后直接返回，不会把结果写成 done/failed。`execute()` 只在 `reviewStatus === 'pending'` 时重启，因此中断的 attempt 不会被恢复流程续跑。
- **边界**：总管只能中止非 Manager 名下的 Run（与 `send_run_msg` 同一规则，Manager 名下的由管理者自己收口）；管理者 `stop_run` 必须落在本项目，越界报 `belongs to another project`。
- **经验审查**：中止也算一次 ending——`stop()` 在 abort 后读该 attempt 留下的报告，以 `stopped` 标记调用 `reviewExperience`。报告里有明确步骤段落仍可产候选（描述注明 stopped early 与原因），但**不会**把注入的 skill 标 `verification = failed`：主动收回不等于流程失效。

消息 ID 与通知 ID 均由调用派生，Durable 重放不产生重复消息；已读状态持久化。工兵被要求优先自行决策，只在破坏性操作、缺失凭据或根本性歧义时提问。

报告从 `TIAN_REPORT.md` 收集到 `<project root>/.tian/runs/`，每轮独立保留，报告不进入代码提交。

## 工兵执行器（提案）

工兵的执行器可配置：Pi Durable（默认），或 Codex、Cursor 等外部编码 Agent CLI。角色规则不随执行器改变：工兵没有记忆，输入只有简报与 worktree，上级是项目管理者。

执行器与模型通过 Intent 选择：

1. **Settings**：用户启用执行器（Pi 始终可用；外部 CLI 必须已安装并已登录），并定义 Intent。Intent 把一个名字映射到执行器、模型与思考等级，例如 `review` → Sol 6.1，`simple` → DeepSeek 4.1 Flash。
2. **项目默认**：每个项目有一个默认 Intent（取代 `projects.agent_kind`）。
3. **派发**：管理者为每个 Run 用两种互斥方式之一选择：一个 `intent`，或明确的 `runtime` + `model`（+ `thinking_level`）。两者同时给出报错；都不给则用项目默认 Intent。明确选择必须使用已启用的执行器；Pi 模型按 provider 目录校验（D13），外部模型原样传递不校验（D21）。每个 Intent 带一段用途说明，管理者的 `<state>` 列出 Intent 名称与用途说明。

Run 在创建时保存解析后的执行器、模型与思考等级，之后修改 Intent 不影响已有的 Run。Run 的执行器固定：follow-up Attempt 与重启续接都沿用它，因为 resume 依赖执行器的 session id。换执行器需要新 Run。

Pi Durable 工兵保持现有契约：运行中消息（`ask_manager`、`tell_manager`、`check_msgs`）、durable replay、从会话条目读取进度、同一会话内的 follow-up Attempt。

外部工兵遵守“一次性执行 + resume 续接”的基线契约：

- **启动**：适配器在 Run 的 worktree 中以无交互模式运行该 Agent，简报作为 prompt。
- **进度**：适配器读取 Agent 的结构化事件流（例如 Cursor `--output-format stream-json`、Codex `exec --json`），供 `run_progress` 使用。
- **结果**：进程退出即 attempt 结束。最终文本或 `TIAN_REPORT.md` 作为报告。Agent 运行中不提问，把未决问题写进报告。
- **中止**：`stop_run` 终止进程。worktree 保留，与 Pi 工兵相同。
- **跟进**：管理者用 follow-up Attempt 回答未决问题。适配器用 Run 上保存的 session id 续接同一个外部会话（例如 Cursor `--resume <chatId>`、Codex `exec resume`）。
- **服务重启**：外部工兵是服务的子进程，不是 durable 的；崩溃、手动重启或机器重启都会杀掉它（升级会先等空闲，见 [D9](decisions.md)）。服务启动后在同一个 Attempt 内自动续接该外部会话，并带以下护栏：
  - 续接前，服务先给 worktree 做快照提交，重启前的工作保持可查。
  - 续接 prompt 说明进程被杀，给出事件流中最后记录的工具调用，并告诉 Agent 这次调用可能没有完成：先检查 worktree 状态，未经检查不要重复有副作用的操作。
  - 每个 Attempt 最多自动续接一次。同一 Attempt 内第二次被杀、没有 session id、或续接失败，都把 Attempt 标为 `interrupted`（worktree 保留，与 `stop_run` 相同）并唤醒管理者。
  - 每次自动续接都给管理者发一条不阻塞的通知。
  - Attempt 保留原截止时间，并直接占用并发槽位，与 Pi 工兵重启后的规则相同。
- **安全边界**：目标是所有执行器共用一套由 Tian 控制的 Seatbelt 边界（[todo-worker-sandbox.md](todo-worker-sandbox.md)）。Tian 包住整个外部 CLI 进程：worktree 与该 CLI 的会话存储可写，CLI 配置只读，拒绝服务 socket，允许网络，环境变量按白名单只传该 CLI 需要的凭据。内部关闭 CLI 自己的沙箱（macOS 上嵌套 Seatbelt 通常失败，待验证）。由于各 CLI 的状态目录结构不同、实现困难，这个目标不是上线前提。在它实现之前，过渡底线是：环境变量白名单（必须）、CLI 自己的沙箱参数（例如 Codex `--sandbox workspace-write`、Cursor `--sandbox enabled`）、以及在 Settings 中对每个执行器的明确启用确认，确认文字说明该执行器能访问服务 socket 与它自己的配置。

并发有两层限制：

1. **全局上限**：`MAX_ACTIVE_ATTEMPTS` 移到 Settings（默认 3），计入所有执行器的工兵 attempt。它保护本机资源（CPU、内存、构建与测试）。
2. **执行器上限**：可选，默认不设。它保护外部额度与速率限制（例如 Cursor 设为 2）。

attempt 必须同时拿到全局槽位与所属执行器的槽位才能开始。队列不是严格先进先出：只因执行器槽位满而等待的 attempt，不阻塞后面执行器有空位的 attempt。总管与管理者的轮次不设上限；它们是模型调用，多个管理者可以同时思考与派发。

经每个 Run 的 MCP server 实现运行中消息，是以后适配器可声明的可选能力，不属于基线。原因：基线只依赖无交互执行、结构化输出与 resume，主流 Agent CLI 都具备，新接一种执行器的成本低。代价：外部工兵遇到阻塞性歧义时不能停下来问，一问一答要花一整个 Attempt。
