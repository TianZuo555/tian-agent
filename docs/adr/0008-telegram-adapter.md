# Telegram 适配器：long polling + 白名单 chat，转发以会话游标恰好一次

渠道网关的第一实现是 Telegram Bot：服务进程内长轮询收消息，白名单授权，chat 绑定到稳定会话；总管在会话中的完成回复回发到 chat。不做公网回调，不引入新依赖。

## 背景

`openSession({channel, externalId, scopeId})` 已提供稳定的渠道绑定与 Durable `requestId` 去重，但没有渠道真正收发消息。PRD F11（M3）要求 Telegram Bot 用 long polling 接入，按 chat ID 白名单授权；token 存于 `<dataDir>/service.env`。适配器必须是服务的一个可失败组件：没有 token 时整个服务照常工作。

## 决定

- **传输**：`getUpdates` 长轮询，全局 `fetch`，无新依赖。网络或 HTTP 错误按指数退避（1s 起，封顶 60s），循环永不抛出；offset 持久化在自己的 `telegram_state` 表，只有在输入被 Durable 稳定受理（`submit` 返回）后才推进，因此重启不会重放已处理的更新，重复投递的同一条更新靠 `tg:<chatId>:<message_id>` 去重。
- **授权**：`TELEGRAM_ALLOWED_CHAT_IDS` 逗号分隔白名单，非白名单 chat 只记录 chat ID 后忽略。token 只出现在请求 URL 路径，错误日志会将其改写为 `[REDACTED]`。
- **会话与 scope**：chat 的当前 scope 持久化在自己的 `telegram_chats` 表（默认 `global`）；`/scope` 切换时复用渠道绑定为该 (chat, scope) 打开独立 conversation。`/status`、`/help` 是适配器本地命令，直接读 `tian.db`，不进入模型。
- **出站转发**：以 conversation 为单位维护持久游标（`telegram_forward_cursor`），只转发已提交的 `pi.assistant` 条目中的文本块（流式片段存于 `pi.live` 文档，天然不会转发；thinking 与 tool call 块被过滤）。触发采用「重启补扫 + conversation watch 推送」：启动时从游标补扫，之后由 watch 在新条目提交时即时触发；发送成功后才推进游标。消息按行边界拆分为不超过 4096 字符的纯文本。
- **可测试与配置边界**：Bot API 收敛为两个方法（`getUpdates`/`sendMessage`）的注入接口，测试用假 API 驱动真实轮询循环、退避与游标恢复。渠道配置只在 `service/entry.ts` 读取 `service.env` 后显式传入（`ResidentServer` → `Service`）；`Service` 不读 `process.env`，没有配置就是不启动，测试与临时实例不会触网。
- **维护与授权**：进入维护时先停网关再检查空闲，`stop()` 等待在途提交与转发真正结束；白名单在唯一出站路径（`forwardChat`）上校验，被移出白名单的 chat 不再收到任何主动输出，也不会再挂 watch。
- **触发合并**：conversation watch 的每次视图变化只置脏标记，每个会话最多一个进行中加一个待执行转发，避免流式更新引发大量分页读取。

## 后果

- 审批（Approval）与 Goal 通知可以复用同一核心接入：命令入口已在适配器本地命令层预留，主动推送复用转发通道。
- 出站转发的"恰好一次"以进程生命周期为界：进程在"发送成功"与"游标落库"之间崩溃会重发一条；Telegram 无客户端去重键，这是纯轮询方案的理论下界。
- 对端永久失败（如 bot 被拉黑）会阻塞该会话后续转发并每次触发时记录错误，不会自动跳过，避免静默丢消息。
- 非文本消息（图片、贴纸等）与群组话题暂不处理；白名单为空时适配器启动但不放行任何 chat。
- `stop()` 不再有超时兜底：在途 Bot API 调用共用被 abort 的 signal 立即失败，因此停网关可以等待到底；代价是若某次 `sendMessage` 既不返回也不响应 abort，维护会一直等。
