# Pi Server API v1

**English** | 简体中文 (to follow)

Status: Draft v0.1 — 2026-11. Supersedes the client-facing part of `SERVICE_PROTOCOL = 13`.

## 1. Invariants

1. The server is the only writer of durable state. Clients hold a cache, never the truth.
2. Every request is safe to retry. A retry reuses the `requestId` of the original intent.
3. Events are ordering hints, not the source of truth. A client that detects a gap re-syncs by snapshot; it never patches around the gap.
4. A slow or blocked client must not slow the server. The server disconnects it and lets it re-sync.
5. One protocol for every transport. The transport changes the address and the credentials, not the frames.

## 2. Transports

| Transport                     | Where                              | Trust                                                                                         |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Unix socket                   | Client on the server machine       | File permissions (`0700` data dir, socket inside it) + `uid` check                            |
| WebSocket over TLS (`wss://`) | Client on any other tailnet device | Tailscale node identity, verified by the server with `tailscaled` `WhoIs` on the peer address |

Rules:

- Both transports carry the same messages. A frame is one JSON object; on the Unix socket it ends with `\n`, on WebSocket it is one text frame.
- TLS is not optional off-localhost: `ws://` is accepted only on `127.0.0.1`.
- The server binds the WebSocket listener to the tailnet interface only. It must not listen on a public interface, and Tailscale Funnel stays off in v1.
- The browser build (web target) uses the WebSocket transport only.
- Compression (`permessage-deflate`) is negotiated and used for frames above 4 KiB.

## 3. Identity and Authentication

Single user, several devices. There are no passwords and no account service.

- **Node identity.** The server trusts `tailscaled`'s view of the peer: node id, hostname, user. A connection from a node that the ACL does not allow never reaches the application.
- **Device record.** The first successful handshake creates a row keyed by tailnet node id: `deviceId` (server-generated UUID), `nodeId`, `name`, `platform`, `firstSeen`, `lastSeen`, `revokedAt`. The client stores `deviceId` in the platform keychain and sends it in `hello`.
- **Automatic enrollment.** A node that reaches the listener is the owner's device only because the ACL admits only the owner's identity. If the tailnet admits other users, the ACL is no longer the identity boundary and enrollment needs an explicit approval step.
- **Device revocation.** `revokeDevice(deviceId)` closes live connections of that device and sets `revokedAt`; the row stays as the denylist, so a later handshake from the same node id is refused. Removing the node from the tailnet also works, but revocation is the fine-grained tool.
- **Local socket.** The server checks the peer `uid` against the owner of the data directory. `deviceId` is still sent and recorded, so the same device appears once in the device list.
- No tokens in URLs, query strings, or logs.

## 4. Handshake and Versioning

The first frame from the client:

```json
{
  "type": "hello",
  "minProtocol": 14,
  "maxProtocol": 14,
  "clientVersion": "0.5.0",
  "platform": "macos",
  "deviceId": "6f1c…",
  "deviceName": "Tian's MacBook Air",
  "capabilities": ["markdown-v2", "inline-approval"],
  "resume": { "cursor": 812_044 }
}
```

The server answers with one of:

```json
{
  "type": "welcome",
  "protocol": 14,
  "serverVersion": "0.6.2",
  "serverId": "b0e1…",
  "deviceId": "6f1c…",
  "limits": { "frameBytes": 4_194_304, "requestsInFlight": 64, "streamHz": 20 },
  "capabilities": ["markdown-v2", "inline-approval", "search"],
  "resume": { "from": 812_044, "available": true },
  "serverTime": "2026-11-05T09:12:33.981Z"
}
```

```json
{
  "type": "reject",
  "code": "protocol",
  "message": "Client too old",
  "supported": [13, 14]
}
```

Rules:

- The client sends a range; the server picks the highest common version. No common version means `reject`, and the client shows an upgrade screen.
- The server supports the current protocol and one previous major version. A version is bumped only for a breaking frame or semantic change.
- `capabilities` replaces version sniffing for additive features. A client must not infer a feature from `serverVersion`.
- The current implementation (`SERVICE_PROTOCOL = 13`) sends `{type:'ready', info}` and requires an exact match. The target server keeps that protocol-13 handshake for one release cycle so the current Electron client keeps working, and adds `hello`/`welcome` as protocol 14.

## 5. Frames, Limits, Keepalive

| Limit                             | v1                                                                        | Current code                                                              |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Inbound frame                     | 4 MiB, checked twice (client preflight, server hard limit)                | Server accepts 1 MiB, client allows 16 MiB (`server.ts` vs `protocol.ts`) |
| Outbound event frame              | 4 MiB. Larger payloads are paged by the client                            | Snapshots can exceed 1 MiB today                                          |
| Requests in flight per connection | 64                                                                        | 128                                                                       |
| Streaming rate per conversation   | 20 Hz, then a final frame                                                 | Unbounded                                                                 |
| Keepalive                         | Protocol 14: server `ping` every 20 s; connection idle for 60 s is closed | Protocol 13: TCP keepalive only (no application frame)                    |
| Reconnect backoff                 | 0.5 s doubling to 30 s, jittered                                          | Same, no jitter                                                           |

The asymmetry above is a real defect today: a client can send a frame the server rejects, and the connection drops with no error frame. v1 fixes it with one published limit and a typed error.

## 6. Requests, Results, Errors

```json
{ "type": "request", "id": "c7", "client": 3, "command": "submit", "args": ["conv-1", "hello", "req-9f2"] }
{ "type": "result", "id": "c7", "result": { "submissionId": "sub-1" } }
{ "type": "result", "id": "c7", "error": { "code": "conflict", "message": "…", "retryable": false } }
```

- `id` is connection-local, unique while in flight. `client` is a connection-local subscription key (the Electron build uses `webContents.id`); the server maps it to a canonical id per connection. A device may open several clients (windows) over one connection.
- Errors carry a code: `protocol`, `unauthorized`, `not_found`, `invalid`, `conflict`, `busy`, `unavailable`, `internal`. `retryable` tells the client whether re-sending with the same `requestId` is safe (it always is for `unavailable` and `busy`).
- Timeouts: fast commands 10 s, work-starting commands (`submit`, `runGoalNow`, `dispatch`) 60 s, `abort` 10 s. A timeout does not cancel the server-side operation; the client reconciles from events.
- Cancellation: closing the connection cancels nothing. `abort` is the only cancellation.

## 7. Events, Revisions, Resume

Every event carries a connection-level sequence and a per-channel revision:

```json
{ "type": "event", "seq": 812_045, "channel": "conversations", "revision": 71, "payload": [ … ] }
```

- `seq` is monotonic per server, not per connection. It powers resume.
- `revision` is monotonic per channel. Clients reject a payload whose revision is not greater than the cached one (the current renderer already drops stale responses; this makes the rule explicit).
- Payloads stay **whole snapshots per channel** in v1, as today (`src/shared/types.ts:399`). Deltas are a later optimization; snapshot-per-channel keeps reconnect logic trivial and matches the existing reducer.
- `subscribe` (today `watch`) names a conversation; the server sends `view` snapshots for it, throttled to `streamHz`.
- **Resume.** On reconnect the client sends the last `seq` it applied. The server replays only the channels whose revision changed since that `seq`, as fresh snapshots. If the server cannot answer (log rotated beyond the cursor), it sets `resume.available = false` and the client does a full sync: `listScopes`, `listConversations`, then one snapshot per channel.
- A channel snapshot larger than the frame limit is paged: `page` events carry `{channel, revision, part, total}` and the client assembles before applying. Conversations transcripts use the paging command in §10 instead.

## 8. Idempotency and Retries

- `requestId` is **required** for every write in v1 (for example `submit`, `addProject`, `addTask`, `doneTask`, `createGoal`, `updateGoal`, `setGoalStatus`, `addSchedule`, `followUpRun`, `landRun`, `shipRun`, `discardRun`, `setProviderKey`, `setWorkers`). In protocol 13 it is optional and only on `submit`.
- The client generates `requestId` once per user intent — a click, a submit, an approval — and keeps it for every retry of that intent, including retries after reconnect or app restart.
- The server keeps a dedupe record `(conversationId, requestId) → result` for 7 days or until the intent's turn finishes plus 24 h, whichever is longer. A duplicate returns the original result with `deduped: true`.
- The server never deduplicates by message text.

## 9. Multi-Device Semantics

- The server owns read state: `lastReadMessageId` per conversation **per device**, plus a rolled-up unread count per conversation. `markRead(conversationId, messageId)` updates it and emits `conversations` with new revisions.
- Presence is advisory: `runtime` and per-bot status tell every device what is working. No typing indicators in v1.
- Two devices may submit to the same conversation. Serialization is the server's job (Pi queues turns per conversation); the UI shows the queue position from `view` snapshots.
- Closing the last client does not stop anything. Runs and Durable turns continue.

## 10. Command Surface

Current state: 75 commands in `src/shared/contracts.ts`, validated with TypeBox on the server. v1 keeps the semantics and groups them; renames happen only where the transport forces a change.

| Group                   | Commands (current names)                                                                                                                                                 | v1 change                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Service                 | `getActivity`, `beginMaintenance`, `finishMaintenance`                                                                                                                   | Keep; `beginMaintenance` becomes server-owner only                                                    |
| Scopes and projects     | `listScopes`, `addProject`, `updateProject`, `removeProject`, `pickDir`                                                                                                  | `pickDir` moves to the client for local use; add `listDirectory` for server-side browsing (see below) |
| Conversations           | `listConversations`, `createConversation`, `openSession`, `openManager`, `archiveConversation`                                                                           | Add `markRead`, `pageMessages`, `searchConversations`                                                 |
| Turns                   | `submit`, `abort`, `watch`, `unwatch`                                                                                                                                    | `requestId` required for `submit`; `watch` → `subscribe` (alias kept)                                 |
| Tasks, goals, schedules | `listTasks`, `addTask`, `doneTask`, `listGoals`, `createGoal`, `updateGoal`, `setGoalStatus`, `runGoalNow`, `addSchedule`, `removeSchedule`                              | Keep                                                                                                  |
| Runs                    | `runList`, `runReport`, `runDiff`, `followUpRun`, `stopRun`, `landRun`, `discardRun`, `shipRun`                                                                          | Keep; `dispatch` and `sendRunMsg` stay agent tools, not socket commands                               |
| Memory                  | `memoryDump`, `memoryRevise`, `memoryForget`, `memoryPromote`, `memoryDismiss`, `memorySelect`, `memoryDeselect`                                                         | Keep; read-mostly from the client                                                                     |
| Inbox, notices          | `inboxList`, `listNotices`                                                                                                                                               | Keep                                                                                                  |
| Improvements            | `listImprovements`, `getImprovement`, `addImprovement`, `setImprovementStatus`, `promoteImprovement`, `reportClientIssue`                                                | Keep                                                                                                  |
| Skills                  | `skillList`, `skillHistory`, `skillApprove`, `skillRetire`, `skillRollback`                                                                                              | Keep                                                                                                  |
| Settings and usage      | `getSettings`, `setModel`, `setManagerModel`, `usageStats`                                                                                                               | Keep                                                                                                  |
| Models                  | `modelCatalog`, `refreshModels`, `builtinProviders`                                                                                                                      | Keep                                                                                                  |
| Providers               | `listProviders`, `addProvider`, `updateProvider`, `removeProvider`, `setProviderKey`, `deleteProviderKey`, `providerLogin`, `providerLoginAnswer`, `providerLoginCancel` | Keep                                                                                                  |
| Workers                 | `setWorkers`, `runtimeStatus`                                                                                                                                            | Keep                                                                                                  |
| Channels                | `wechatStatus`, `wechatRelogin`                                                                                                                                          | Keep                                                                                                  |
| Attachments             | —                                                                                                                                                                        | Add `uploadAttachment` for client-local files                                                         |
| Approvals               | —                                                                                                                                                                        | Add `resolveApproval` for the blocking approval card                                                  |
| Devices                 | —                                                                                                                                                                        | Add `listDevices`, `revokeDevice`                                                                     |

Commands added for the chat-first client (required for v1):

- `pageMessages(conversationId, { before?: messageId, limit: number })` → `{ messages, nextBefore }`. A transcript must not arrive as one snapshot; chat apps open long histories.
- `markRead(conversationId, messageId)` → `{ unread }`.
- `searchConversations(query, { limit })` → `ConversationInfo[]`. History search already exists as agent tools (`search_history`); the client needs the same index.
- `listDirectory(path)` → `{ entries: [{ name, path, kind }] }`. Runs execute on the server, so project paths are server paths. A remote client browses the server's filesystem through this command instead of a native picker.
- `uploadAttachment(uploadId, name, mediaType, size, offset, dataBase64)` → `{ uploadId, received, path? }`. The first call passes `null` for `uploadId`; later calls pass the returned id. The client sends chunks under the frame limit, and `path` is set when `received` equals `size`. Chunks are idempotent by `(uploadId, offset)`.
- `resolveApproval(approvalId, decision: 'allow' | 'deny')` → `{ resolved: boolean }`. The approval card in [ui.md](ui.md) uses this; the server records the decision and wakes the blocked turn.

## 11. Security

- The WebSocket listener accepts only tailnet peers. Check the peer address at accept time, then `WhoIs`, then the device record; drop the socket on any failure without an application frame.
- `wss` only off-localhost. Reject `Origin` headers from browsers other than the configured web origin (the web build is served from the tailnet host in v1).
- Commands run with the server user's privileges; there is no per-command sandbox. The trust boundary is the tailnet plus the device list, so the ACL must limit the server port to the user's own devices.
- The server logs device id, node id, and command name per request. It never logs message bodies or model keys.
- Model keys live only on the server (`<dataDir>/service.env`, `0600`).

## 12. Compatibility Policy

- Protocol major bump: a breaking frame change. The server keeps the previous major alive for one release cycle; the client negotiates. Protocol 14 keeps the protocol-13 `ready`/`info` handshake during that window. Application-level `ping` is gated to protocol 14; protocol-13 connections keep TCP keepalive.
- Additive changes ship behind `capabilities`, never a protocol bump.
- The web build is pinned to the server version: it is served by the server, so version skew is not possible.
- App store clients cannot be forced to update. A client older than `minClientVersion` gets a blocking upgrade screen but can still read cached data.

## 13. Migration from Protocol 13

1. Add `hello`/`welcome` at protocol 14 with range negotiation while keeping the protocol-13 `ready`/`info` handshake. The current Electron client keeps working; the new server accepts both.
2. Make `requestId` required for writes; the new client generates it. Keep accepting `submit` without it for one cycle (server generates and logs a warning).
3. Add `seq`, `revision`, and the one published frame limit. Gate `ping` to protocol 14; protocol-13 connections keep TCP keepalive. Existing event consumers ignore unknown fields.
4. Add the WebSocket listener and device table. No change to the Unix socket path.
5. Add `markRead`, `pageMessages`, `searchConversations`, `listDirectory`, `listDevices`, `revokeDevice`.
6. Set `SERVICE_PROTOCOL` to 14 when negotiation and the required `requestId` land; drop the protocol-13 `ready` handshake and optional `requestId` in the next release.

## 14. Open Questions

1. Is `permessage-deflate` worth it for JSON snapshots, or is a binary codec (MessagePack) the better long-term answer? Decide after measuring a real 50k-message transcript.
2. Should `markRead` be per device or per user with a per-device override? Per device is the smaller step; a "read on one device clears all badges" toggle may be wanted.
3. Do we need server-side rate limiting per command before the first public-ish deployment, or is tailnet-only enough for v1?
4. `listDirectory`: free browsing, or a configured root allowlist? Free browsing matches a personal server; an allowlist is cheaper to reason about.
