# 改进日志

[English](../improvement-log.md) | **简体中文**

Log 视图和 `improvements` 表记录值得改进的产品问题、使用摩擦、想法与成功经验，与审计 Event、Memory 分开（[D11](decisions.md#d11--改进日志用户与总管可写系统错误自动指纹化)）。

- 一条条目带 `kind`（issue / friction / idea / win）、`status`（open / promoted / resolved / dismissed）、severity、来源（user / chief / system）和 scope；可选关联 Run、Conversation、Event。列表只取摘要，展开时才读取 detail。
- 总管用 `log_improvement` 写入，用户可在 Log 视图新建；`list_improvements` 用于避免重复记录。
- 服务启动、监听、Inbox、History、通知、调度、Run、Land/Ship、Telegram 与渲染层的异常会通过同一个 `reportIssue` 汇点自动记录。相同 `area + error name + code + message` 在同一 scope 的 open/promoted 条目上合并为一条并累计 `occurrences`；正文脱敏 bot token、Bearer、`sk-*` 和常见密钥赋值。
- Promote 在同一事务中创建一条带 `improvement:<id>` 去重键的待办 Task，并回写 `task_id`；重复操作复用同一条 Task。
- 自动捕获是 best-effort，写入失败只回退到 `console.error`，不阻塞原业务。原始进程输出仍写入 `service.log`。
- 新增 Log 命令与 `improvements` 事件把 `SERVICE_PROTOCOL` 升到 3（此后其它特性继续递增，当前值见 `src/shared/service-paths.ts`）。
