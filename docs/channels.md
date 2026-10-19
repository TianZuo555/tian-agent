# 渠道与会话

所有入口共享一个后端与 scope 记忆。`openSession({ channel, externalId, scopeId })` 为渠道会话查找或创建稳定的内部 conversation：不同渠道、外部会话或 scope 得到不同 conversation。绑定持久化，重启后复用。

例如 App 与 Telegram 都绑定 `global`：两条独立的聊天上下文，但每次请求加载同一份全局 Memory。只留在聊天记录里、没有沉淀为 Memory 的内容不会自动进入其他 Session。外部输入可向 `submit` 提供稳定 `requestId`，由 Durable 去重。

`channel = 'manager'` 是保留的内部绑定：每个项目至多一条项目管理者会话（`external_id = scope_id = project_id`），公开 `openSession` 拒绝绑定它，面向用户的入口是 `openManager(projectId)`（见 [agent-work.md](agent-work.md#项目管理者)）。

## Telegram

服务内置 Telegram Bot 适配器：Bot API long polling，无需公网入口。未配置 token 时适配器不启动，服务其余部分不受影响；网络故障按指数退避重试，不阻塞服务。

在仓库 `.env` 中配置，再 `mise run service:env && mise run service:restart`：

```sh
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_CHAT_IDS=111111111,222222222
```

- 只有白名单中的 chat 可以触发对话，其余更新只记录 chat ID 并忽略。
- 每个 chat 维护一个当前 scope（默认 `global`）：`/scope` 查看，`/scope 项目名` 切换；切换后消息进入该 scope 的独立 conversation，选择持久化。`/status` 显示当前 scope 的待办任务与运行中的 Run；`/help` 列出命令，未知命令同样返回帮助。
- 收到的消息以 `tg:<chatId>:<message_id>` 为稳定 `requestId` 提交，重复投递不会重复提交；`getUpdates` offset 持久化，重启不重放已处理的更新。
- 所在会话的总管回复（直接回复与主动汇报）以纯文本发回 chat：按行边界拆分为不超过 4096 字符的消息；转发游标持久化，重启不重发也不漏发；流式片段、工具调用与思考内容不转发。
- 审批等受控操作尚未接入 Telegram，命令入口与推送通道为后续接入预留。

## Inbox

外部参与者向 `<scope root>/.tian/inbox/*.md` 投递消息：

```md
---
id: external-message-123
from: external-agent
to: chief
ts: 2026-01-01T00:00:00Z
thread: optional-thread
---

消息正文
```

先写非 `.md` 临时文件，再 rename 发布。服务按 `(scopeId, messageId)` 导入 SQLite，逐条记已读；`fs.watch`、启动扫描与定期扫描共同处理遗漏。外部消息生成持久化通知；总管自身和 Run 完成消息不重复唤醒。
