# 渠道与会话

[English](../channels.md) | **简体中文**

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

## 微信（iLink / ClawBot）

适配器走腾讯 iLink Bot 协议（微信「设置 → 插件」里的官方 ClawBot 插件），底层用 `@wechatbot/wechatbot` SDK：扫码登录 + 长轮询，官方通道、不需要公网入口，也不是客户端 hook。凭证、游标和 `context_token` 由 SDK 存在 `<dataDir>/wechat/`。

```sh
WECHAT_ALLOWED_USER_IDS=wxid_您本人的id@im.wechat
```

写进仓库 `.env` 后 `mise run service:env && mise run service:restart`。白名单为空时适配器完全关闭——首次登录前先留空并重启，扫码成功后 App 的 **Settings → Channels** 会显示机器人账号（`…@im.bot`），把您本人的 `…@im.wechat` 加进白名单再重启一次。

- 扫码登录：服务启动时若无凭证，会把二维码 URL 发布到 Settings → Channels（同时支持配对码）。扫码确认后凭证持久化，重启自动恢复；二维码过期或换号用「重新生成二维码」。
- 只有白名单内的用户能触发对话。每个用户一条稳定会话，默认 scope 为 `global`，命令与 Telegram 相同（`/scope`、`/status`、`/help`）。入站 `requestId` 为 `wx:<userId>:<messageId>`，重启不重放。
- 总管回复以纯文本回发，转发游标持久化。微信在每次用户消息后只给约 10 条机器人消息，且 `context_token` 24 小时后失效；发送被拒时游标不前移，等用户下次发消息（开新窗口）自动补发，既不丢也不重复。
- **24 小时保活**：用户长时间沉默时，服务在窗口内最多发两条一个字符的「.」（间隔 ≥11 小时、距窗口结束还有 30 分钟以上才发）；保活被拒说明窗口已关闭，此后不再试探，等用户主动发消息。这样既保住推送窗口，又不白白耗尽 10 条额度。
- 已知限制：iLink 的扫码机器人只能私聊，拉不进普通微信群；不支持快捷命令菜单（`/model` 只能带参数使用）。

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

先写非 `.md` 临时文件，再 rename 发布。服务按 `(scopeId, messageId)` 导入 SQLite，逐条记已读；`fs.watch`、启动扫描与定期扫描共同处理遗漏。每次扫描只导入本实例未见过的文件，重扫成本低；仅在扫描插入了行或新排入通知时才发出 `inbox` 事件并触发投递。外部消息生成持久化通知；总管自身和 Run 完成消息不重复唤醒。
