# History 是 Pi transcript 的派生索引，业务事实统一写入 Event 表

History（PRD F02）与 Event 审计（PRD §3.1）落在 `tian.db` 的两个新增区域：`events` 表保存已发生的业务事实，`history_entries` + `history_fts` + `history_cursors` 保存可丢弃重建的检索索引。Pi 的 `pi-session.sqlite` 仍是会话内容的唯一来源。

## 背景

Pi Durable 已经持久化了全部会话条目，但检索它需要理解它的分页、fork 与 head 语义；Chief 也不该在每次提问时把历史塞进 Prompt。PRD 要求按时间、Scope、Conversation、关键词检索消息、工具调用与结果，以及 Task/Run 状态变化与审批决定，并给出可定位的引用。同时 PRD §3.1 要求状态变化写入 Event 并驱动通知，而现有代码只有通知 outbox，没有统一的审计记录。

## 决定

- **Event 表**：`events(id, at, type, actor, scope_id, goal_id, task_id, run_id, conversation_id, summary, payload)`。`id` 尽量由调用派生（如 `run:<id>:dispatched`），写入用 `INSERT OR IGNORE`，因此重放与重启不会产生重复事件。API 只有 `record` / `get` / `list`，其他功能直接调用 `record`。
- **派生索引**：`history_entries` 以 `(conversation_id, entry_id)` 为主键，FTS5 用 `trigram` 分词（中文可检索）。事件索引进同一张 FTS 表，以 `conversation_id = ''` 区分，引用为 `event:<id>`。
- **增量同步**：`history_cursors` 记录每个会话已索引的最大 entry id（事件用单独的游标）。同步按 entry id 升序分页，只处理游标之后的部分，因此重复同步不产生重复行；删表后一次全量同步即可恢复。
- **同步时机**：服务启动后在后台补齐（不阻塞启动）、会话有新输入或 watch 推送变化后延迟补同步、每次检索前对目标 scope 惰性补齐。维护模式下后台同步暂停。
- **检索**：trigram 无法匹配少于 3 个字符的词，这些词改用 `LIKE`；多词按 AND 组合。结果按 FTS rank、再按时间倒序，去重后按约 1500 token（`ceil(utf8Bytes/3)` 估算）截断，无命中明确返回 `(no matches)`。
- **引用**：`conv:<conversation>#<entry>` 与 `event:<id>`；`read_history` 用 entry id 窗口展开上下文，事件显示 actor、summary 与 payload。

## 后果

- History 可以随时删除重建，升级或索引格式变化不需要迁移数据；Pi storage 损坏才是不可恢复的。
- 索引写入不进入 Pi 的事务，崩溃后最多丢失一段未同步的尾部，下次同步自动补齐。
- 事件是审计来源：审批（M3）与 Task（M2）只需调用 `record`，不必再各自设计日志。
- 检索质量受 trigram 限制：两字中文词走 `LIKE` 全表扫描，在当前数据量下远低于 300ms 目标，但数据量继续增长后需要评估 bigram 分词或额外的 n-gram 索引。
