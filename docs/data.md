# 数据、恢复与检索

## 存储

| 位置                | 内容                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tian.db`           | 项目、会话、渠道绑定、goals、tasks、schedules、runs、attempts、Inbox 及已读状态、通知、幂等记录、`events`、`improvements`，以及可重建的 history 索引 |
| `pi-session.sqlite` | Pi Durable 会话、任务及 transcript                                                                                                                   |
| 文件                | memory、notes、Inbox 输入和报告                                                                                                                      |

只有常驻服务写数据库，前端不是权威来源。两个数据库通过操作 ID 与启动核对衔接，没有跨库原子事务。

## 恢复与通知

服务收到 SIGTERM 后有序关闭；下次启动恢复会话、collector 和原截止时间。恢复遵循工具自己的 replay 策略，不保证任意外部操作恰好一次。

Run 结果与完成通知在同一个业务数据库事务中记录。通知用稳定 `requestId` 提交给总管，再标记 delivered；崩溃后可重投并由 Durable 去重。总管忙时进入 follow-up 队列。

## History 与 Event

Pi transcript 是会话内容的唯一来源；`tian.db` 里只有可丢弃重建的派生索引。业务事实（Run 状态变化、Inbox 导入、通知送达等）写入 `events` 表，并索引进同一份全文检索。

- `events`：`id`（尽量由调用派生，重放幂等）、`at`、`type`、`actor`、`scope_id`、`goal_id`、`task_id`、`run_id`、`conversation_id`、`summary`、`payload`。API 只有 `record(event)`（INSERT OR IGNORE）、`get(id)`、`list(filter)`；其他功能直接调用 `record`。
- `history_entries`：`(conversation_id, entry_id)` 为主键，保存 scope、kind、role、时间与文本。用户输入、助手文本、工具调用（名称 + 截断参数）、工具结果（截断到 2000 字符）都入索引；空内容与 thinking 跳过。事件以 `conversation_id = ''` 存储，引用为 `event:<id>`。
- `history_fts`：FTS5 trigram 分词，中文可直接检索；少于 3 字符的词回退 `LIKE`，多词查询按 AND 组合。
- `history_cursors`：每个会话的同步游标（事件用单独游标），按 entry id 升序分页补齐，重启只补新增部分，重复同步不产生重复行。

同步时机：启动后后台补齐（不阻塞启动）；会话有新输入、watch 推送变化或空闲后延迟补同步；每次检索前对目标 scope 惰性补齐。维护模式下后台同步暂停。

结果按 FTS rank、再按时间倒序排列，去重后按约 1500 token（`ceil(utf8Bytes/3)` 估算）截断。总管检索工具：

- `search_history(query, scope?, since?, until?, limit?)`：默认本会话 scope，`scope: "all"` 检索全部。返回 `[2026-10-11 14:02] conv:12#345 user: …片段…`，无命中返回 `(no matches)`。
- `read_history(ref, around?)`：展开相邻条目或显示事件。
