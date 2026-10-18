# 目标、任务与 Run

用户管理目标，Agent 管理任务。Goal 是长期跟进的结果；Task 是一件具体工作；Run 是工兵为代码类 Task 在隔离 worktree 中的一次执行。

## Goal

Goal 属于一个 scope，带 objective、success criteria、constraints、current state、next action、last execution 与每日预算，存于 `goals` 表。总管用 `create_goal` / `update_goal` / `list_goals` 维护；用户在 Goals 视图创建、编辑、暂停、恢复或取消。

- **Goal 会话**：每个 Goal 通过 `openSession({ channel: 'goal', externalId: goalId, scopeId })` 获得一条专属总管会话，跨重启稳定，唤醒内容只投递到这条会话。
- **用户提醒**：`notify_user(goal, fingerprint, text)` 把需要用户知道或决定的事写入 `user_notices`；同一 Goal 相同 fingerprint 在 24 小时窗口内只送达一次，`outcome = no_change` 的结果不通知。Goals 视图展示提醒列表；Telegram 投递留待后续。

## Task

Task 状态机：`pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`。转换集中在 `db.ts` 一处校验，非法转换抛错。结果单独记 `outcome`（achieved / not_achieved / no_change）与 summary。`trigger`（manual / schedule / event）与唯一 `dedupe_key` 记录来源，重启或重复触发不会生成第二个 Task。

## 调度

`schedules` 表保存 cron、时区与持久化的 `next_fire_at`；服务内定时器睡到最早的触发点（上限 60 秒，不阻塞退出）。每次触发在一个事务内完成：

1. 创建 Task（`dedupe_key = sched:<schedule>:<触发时间>`）。
2. 向 Goal 会话投递通知（内容只含 Goal 状态与本次 Task，不重建历史）。
3. 从当下推进 `next_fire_at`——停机期间错过的触发合并为一次，不补跑。

每个 Goal 的 `max_runs_per_day` 限制每日执行次数；超出后本次唤醒生成 `blocked` Task 并留下去重提醒，不默默丢弃。

代码类任务由 `dispatch` 发起，可选 `task` 参数把 Run 关联到 Task（`runs.task_id`）。Run 完成不等于 Task 完成：总管依据结果调用 `complete_task` / `fail_task` 收口，再 `update_goal` 写回状态。

## Run 生命周期

```text
dispatch → queued → running → collecting → done / failed
                            ↘ discard → interrupted
```

执行与验收状态分别记录；验收状态为 `pending / landing / landed / shipping / shipped / discarding / discarded`。

- Git 项目必须成功创建 worktree，隔离失败终止派发并保留记录；非 Git 项目默认拒绝，明确开启 `allowInPlace` 后才可修改原目录。
- Run 保存派发时的目录、base branch、执行模式及截止时间。
- follow-up 每轮有独立 attempt、输入、结果和报告，复用工兵会话与 worktree。
- 派发用稳定操作 ID，各轮输入用稳定 `requestId`；成功依据 Durable submission 结果，空闲不代表成功，Git 提交失败会进入失败状态。
- 同一 Run 的状态转换与验收串行；discard 先停止工兵，collector 不覆盖其结果。
- Land 合入保存的 base branch，要求主 checkout 位于该分支且无已跟踪文件的未提交修改；land 后不能 follow-up。
- Ship 推送分支，再查询或创建 PR，重复请求复用 PR URL。
- 已开始的 land/ship/discard 先入库，启动时继续或核对。

## 总管 ⇄ 工兵消息

每个 Run 有一条持久消息线程（`agent_messages` 表），双向可达：

- 工兵 `ask_chief(question, wait_seconds?)`：提问并阻塞等待答复。问题经通知管道立即唤醒总管（不等 Run 结束），总管用 `send_run_msg` 回复；等待窗口内无答复则工兵自行判断并在报告中记录。Run 被 discard 时提问立即返回并要求停止。
- 工兵 `tell_chief(text)`：发送不等待的进度通知。
- 工兵 `check_msgs`：读取总管发来的未读消息（答复之外的主动指令）。
- 总管 `send_run_msg(run, body)`：回复提问中的工兵，或对运行中的 Run 主动下达指令；`list_run_msgs(run)` 查看完整线程。

消息 ID 与通知 ID 均由调用派生，Durable 重放不产生重复消息；已读状态持久化。工兵被要求优先自行决策，只在破坏性操作、缺失凭据或根本性歧义时提问。

报告从 `TIAN_REPORT.md` 收集到 `<project root>/.tian/runs/`，每轮独立保留，报告不进入代码提交。
