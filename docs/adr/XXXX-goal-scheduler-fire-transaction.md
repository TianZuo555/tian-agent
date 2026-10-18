# 调度以「一次触发一个事务」推进，唤醒内容只带 Goal 状态与 Task

Schedule 到期时，服务在一个数据库事务内完成三件事：按 `sched:<schedule>:<触发时刻>` 创建（或复用）Task、向 Goal 专属会话写入 Notification、从**当前时刻**推进 `next_fire_at`。停机或休眠期间错过的触发因此合并为一次。

## 背景

F08 要求「没有新消息时自动执行」，同时要求重启不重复执行、错过不补跑风暴（PRD §5.3，场景 C、D）。这几条约束互相拉扯：Task 创建、通知投递与调度指针推进若分属不同事务，任何一次崩溃都可能产生两个 Task、或丢掉一次唤醒、或把同一触发重放很多次。cron 语义本身也有歧义：到期时刻推进到「上次计划 + 1」会在停机后连发多次，推进到「当前时刻之后的第一个」则把错过合并成一次。

## 决定

- **单事务**：Task、Notification、`next_fire_at` 在同一个 `Db.transaction` 内写入。`Db.transaction` 支持嵌套（内层用 savepoint），所以调度器可以在操作 ID 重放的事务里安全调用。
- **去重键是触发槽位**：`dedupe_key = sched:<scheduleId>:<到期时刻 ISO>`。到期时刻取自 `schedules.next_fire_at`，因此重启后重放同一槽位命中同一条 Task；`notifications` 的主键 `task:<taskId>` 再保证通知只入队一次。
- **从 NOW 推进**：`next_fire_at = cron.next(now)`，而不是 `cron.next(上一个计划时刻)`。停机三天后只会跑一次，之后回到正常节奏。
- **唤醒内容最小化**：通知只包含 Goal 的 objective / success criteria / constraints / current state / next action 与本次 Task，不重建会话历史；Chief 需要细节时自己检索。
- **非 active 的 Goal 不触发**，但仍推进指针，恢复后从未来开始。
- **每日预算**：按 `tasks.created_at >= 本地零点` 计数（`blocked` 不计）。超限时创建一条 `blocked` Task（每个 Goal 每天一条，`dedupe_key = cap:<goalId>:<日期>`）并写一条去重后的用户提醒，而不是静默丢弃或无限重试。
- **定时器**：`setTimeout` 睡到最早的 `next_fire_at`，上限 60 秒并 `unref`；关闭与维护期间不触发。时钟可注入，测试不等待。

## 后果

- 调度器与 Chief 职责分离：调度器只决定何时唤醒，做什么由 Chief 在 Goal 会话中决定并写回。
- 一次触发最多一条 Task、一条 Notification；重复触发是幂等空操作。
- 停机期间的多次触发只产生一次执行，代价是错过的那几次不补跑——这符合「活动不等于进展」的产品原则。
- 预算判断依赖本地时区零点；跨时区旅行或改动系统时区时，「今天」的边界会移动。
- 定时器上限 60 秒意味着新增 schedule 最多 60 秒内生效；`fireDue()` 在每次 tick 重新查询，无需唤醒信号。
