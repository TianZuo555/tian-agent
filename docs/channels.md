# Channels and Conversations

**English** | [简体中文](zh/channels.md)

All interaction channels share a single backend service and scope memory. Calling `openSession({ channel, externalId, scopeId })` creates or retrieves a stable internal conversation. Different channels, external sessions, or scopes map to distinct conversations. Channel bindings persist across service restarts.

For example, the desktop application and Telegram can both bind to `global`. They operate as two independent chat contexts, but each request loads identical Global Memory. Content that remains in conversation transcripts without consolidating into Memory does not transfer between sessions. External inputs can provide a stable `requestId` to `submit`, enabling Durable to deduplicate submissions.

The binding `channel = 'manager'` is reserved for internal usage. Each project has at most one Project Manager conversation (`external_id = scope_id = project_id`). Public `openSession` calls reject this channel. The user-facing entry point is `openManager(projectId)` (see [agent-work.md](agent-work.md#project-manager)).

## Telegram

The resident service contains an integrated Telegram Bot adapter. It uses Bot API long polling without public ingress endpoints. If no token is configured, the adapter stays inactive and the rest of the service functions normally. Network errors trigger exponential backoff without blocking the service.

Configure credentials in `.env`, then run `mise run service:env && mise run service:restart`:

```sh
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_CHAT_IDS=111111111,222222222
```

- Only allow-listed chat IDs can start conversations. The adapter logs unauthorized chat IDs and ignores them.
- Each chat tracks a current scope (defaults to `global`). Use `/scope` to inspect and `/scope <project>` to switch. Switching routes subsequent messages into a distinct conversation for that scope. The selection persists. The `/status` command displays pending tasks and active Runs. The `/help` command lists available commands. Unknown commands return help text.
- Incoming messages submit with stable `requestId` format `tg:<chatId>:<message_id>`. Repeated deliveries do not submit duplicate turns. The `getUpdates` offset persists across restarts.
- Chief responses (direct replies and proactive reports) return to Telegram as plain text. Long messages split along line breaks into segments under 4,096 characters. Forwarding cursors persist in SQLite to prevent duplicate or omitted transmissions. Streaming fragments, tool calls, and thinking blocks do not forward.
- Controlled operations like approvals are not yet connected to Telegram. Command inputs and push pipelines remain reserved for future releases.

## WeChat (iLink / ClawBot)

The WeChat adapter implements the official Tencent iLink Bot protocol (the official ClawBot plugin in WeChat "Settings → Plugins"). It uses the `@wechatbot/wechatbot` SDK with QR-code login and long polling. It does not require public ingress endpoints or reverse-engineered client hooks. Credentials, cursors, and `context_token` persist under `<dataDir>/wechat/`.

```sh
WECHAT_ALLOWED_USER_IDS=wxid_your_id@im.wechat
```

Set this variable in `.env`, then run `mise run service:env && mise run service:restart`. When the allow-list is empty, the adapter stays off. Leave it empty before the initial login, restart, scan the QR code in **Settings → Channels**, retrieve your ID (`...@im.wechat`), add it to the allow-list, and restart the service.

- QR Login: When started without credentials, the service publishes the QR code URL to Settings → Channels (with pairing code support). Credentials persist after scan confirmation. Reopen the QR dialog if the code expires or accounts change.
- Only allow-listed users can interact. Each user receives a stable conversation defaulting to scope `global`. Commands mirror Telegram (`/scope`, `/status`, `/help`). Inbound `requestId` uses `wx:<userId>:<messageId>`.
- Chief replies return as plain text with persistent cursors. WeChat limits bots to approximately 10 proactive messages per user turn, and `context_token` expires after 24 hours. When sends fail, the forwarding cursor does not advance. Messages dispatch automatically when the user starts a new conversation window.
- **24-Hour Keepalive**: During extended user silence, the service sends at most two single-character keepalive probes (`.`) per window. Probes fire only when silence exceeds 11 hours and at least 30 minutes remain before expiry. If a probe fails, the window marks as closed and stops probing until the user speaks.
- Known limits: iLink scan bots support private direct messages only. Group chats are not supported. Slash menus are not available.

## Inbox

External participants deliver messages to `<scope root>/.tian/inbox/*.md`:

```md
---
id: external-message-123
from: external-agent
to: chief
ts: 2026-01-01T00:00:00Z
thread: optional-thread
---

Message body text
```

Writers should stage changes in non-markdown temporary files and rename them into place. The service imports entries by `(scopeId, messageId)` into SQLite and tracks read status per message. File system watchers, startup scans, and periodic sweeps process missing files. External messages produce persistent notifications. Messages from the Chief and Run completions do not create duplicate wakeups.
