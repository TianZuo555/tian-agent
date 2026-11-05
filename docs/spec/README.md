# Server-First Specs

**English** | 简体中文 (to follow)

Status: Draft v0.1 — 2026-11. Open questions are listed at the end of each document.

## The Model

Pi runs as one server on one machine. It is the single writer: it owns the SQLite databases, Pi Durable conversations, tools, Runs, model keys, and schedules. Every client is a renderer that reads snapshots and submits intents over one protocol.

```
Pi Server  (one machine: launchd/systemd, SQLite, Durable, tools, keys)
    │  Pi Server API v1: hello · call · event · resume
    ├── NSH app on macOS      (AppKit)
    ├── NSH app on Windows    (Win32)
    ├── NSH app on Linux      (GTK 4)
    ├── NSH app on iOS        (UIKit)
    ├── NSH app on Android    (Android views)
    └── NSH web build         (HTML)
          one TSX UI, six targets
```

Reachability: a Unix socket when the client runs on the server machine, a Tailscale WebSocket otherwise. Identity: the tailnet, not a password. Audience: exactly one user with several devices.

Three properties follow, and every spec below depends on them:

1. **The server is authoritative.** A client never computes durable state (a Run finished, a message was delivered, a Task is done). It displays server state and re-syncs after any gap.
2. **Writes are idempotent intents.** A user action carries a stable `requestId`; retries reuse it. The server deduplicates in Durable. No client keeps a write queue.
3. **The client is a view of one protocol.** Platform code exists for transport, storage of identity, notifications, and packaging — not for product logic. Product logic lives in the server or in shared TSX.

## Documents

| Document                       | Covers                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [protocol.md](protocol.md)     | Transports, handshake, versioning, requests, events, resume, idempotency, the v1 command surface             |
| [ui.md](ui.md)                 | Chat-first information architecture, bot identities, message blocks, composer, inspector, secondary surfaces |
| [clients.md](clients.md)       | Six targets, TSX/Rust split, onboarding, cache, packaging, updates, test matrix                              |
| [operations.md](operations.md) | Server host, Tailscale setup and ACL, upgrades, backups, logs, migration, incidents                          |

Decisions are recorded as D24–D29 in [../decisions.md](../decisions.md). The current Electron implementation is described in [../architecture.md](../architecture.md); this spec set replaces the client parts of it.

## Non-Goals (v1)

- Multiple users, tenants, quotas, billing, or audit for third parties.
- Public internet exposure. The server is reachable only from the tailnet; Funnel stays off.
- Offline writes. A disconnected client is read-only over its cache.
- An external bot registry (Grok, Muse, and similar). Bots are Pi roles; see [ui.md](ui.md).
- Replacing Pi Durable or porting it to Rust.

## Vocabulary Delta

| Term         | Meaning in these specs                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Server       | The Pi process that owns state. One per user. Formerly "resident service".                                             |
| Device       | One client installation, identified by a stable id plus its tailnet node.                                              |
| Bot          | The conversation identity of a Pi role: the Chief, one Manager per project, a Worker per Run. Not an external service. |
| Conversation | A chat thread in the UI. Maps to a Pi session plus its role and scope.                                                 |
| Intent       | A user action sent as a request with a `requestId`.                                                                    |

## Open Questions (product level)

1. Does the web build live on the same tailnet host (served by the server) or on a static host with an API-only connection? Both work; the first is one less moving part.
2. Mobile push: skip in v1 (in-app inbox only) or add APNs/FCM in the first iOS release? See [clients.md](clients.md#10-open-questions).
3. Does a Worker Run get its own conversation row, or a nested thread inside its Manager's conversation? [ui.md](ui.md#3-information-architecture) selects nested; confirm with real usage.
