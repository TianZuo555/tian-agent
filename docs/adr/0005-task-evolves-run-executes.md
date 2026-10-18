# 现有 tasks 演进为 PRD 的 Task；Run 是代码类 Task 的执行

PRD 的 Task 不新建一张表，而是由现有的待办 `tasks` 表演进而来：增加 Goal 归属、负责方、完整状态机、触发来源与去重键。现有 Run 保留其全部语义，通过 `task_id` 成为代码类 Task 的执行记录。

## 背景

项目里已有两样东西与 PRD 的 Task 重叠：只有 `open/done` 的待办 `tasks`，以及带 Attempt、执行状态与验收状态分离、可恢复的 `runs`。另建一张 PRD Task 表会留下三个都叫"任务"的概念；而把 Run 直接改造成通用 Task 会把 worktree、Land/Ship 这些代码专属语义带进"每天检查 CI"这类不需要 Worker 的工作。

## 决定

- Task 归属用户或 Agent（`owner`）。用户的普通待办 = 无 Goal、归属用户的 Task；原 `open` 迁移为 `pending`，`done` 迁移为 `completed`。
- Task 状态：`pending → running → waiting_approval → completed`，另有 `paused / blocked / failed / cancelled`。执行状态与结果（`outcome`：达成、未达成、无变化）分别记录。
- 每个 Task 有唯一 `dedupe_key`（如 `sched:<schedule>:<fire time>`），重启或重复触发不会生成第二个 Task。
- 一个 Task 可以有零个或多个 Run；只有需要改文件的工作才派发 Run。Run 的执行状态、验收状态和恢复逻辑不变。
- 由 Chief 自己完成的 Task（查询、汇总、通知）没有 Run，直接在 Goal 的 Conversation 中执行并写回结果。

## 后果

- 界面上 "Schedule" 视图改为 Task Board；对外只出现 Goal / Task / Run 三个词。
- Run 完成不等于 Task 完成：Task 的完成由 Chief 根据 Run 结果与验收状态判断，或由用户确认。
