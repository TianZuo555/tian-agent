# Client UI Spec — A Chat App for Bots

**English** | 简体中文 (to follow)

Status: Draft v0.1 — 2026-11.

## 1. Principle

The client is a chat app. The home screen is a list of conversations with bots; the main surface is one conversation. Everything the agent does happens inside a conversation: asking, reporting, running, approving, reviewing. Everything the user configures is one command-palette search or one inspector tab away.

There are no top-level dashboards. Goals, Inbox, Skills, and Memory keep their functions but lose their tabs (see §7).

## 2. Bots and Conversations

A **bot** is the conversation identity of one Pi role. The role model does not change; the presentation does.

| Bot     | Count           | Conversation                                                                | Status shown                           |
| ------- | --------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Chief   | one per server  | the global scope conversation; pinned to the top of the list                | idle / working / needs input           |
| Manager | one per project | its project conversation; created with the project                          | idle / working / needs input / blocked |
| Worker  | one per Run     | a nested thread under the Manager that dispatched it; archived after review | running / waiting for input / done     |

Bot identity in the header: avatar, name, role badge (`Chief`, project name, `Run`), scope, current model and thinking level, and a state dot. Names come from the server (Chief is fixed; a Manager's name is required at registration, D18).

A conversation maps 1:1 to a Pi session. Its messages are the Pi transcript, transformed by the server (as `src/shared/messages.ts` does today). The client does not merge, reorder, or deduplicate messages.

## 3. Information Architecture

```
┌──────────────┬───────────────────────────────────────────────┬──────────────┐
│ Conversations│  Chat                                          │ Inspector     │
│  search      │  ┌─ header: bot, scope, model, state ────────┐ │ Tasks         │
│  Chief       │  │                                          │ │ Runs          │
│  Projects    │  │  messages (markdown, tool groups, cards) │ │ Notes         │
│   Manager A  │  │                                          │ │ Memory        │
│    └ Run 12  │  │                                          │ │ Details       │
│   Manager B  │  └──────────────────────────────────────────┘ │               │
│  + New       │  ┌─ composer: model · attach · send / stop ──┐ │               │
│  ──────────  │  └──────────────────────────────────────────┘ │               │
│  Settings    │                                               │               │
└──────────────┴───────────────────────────────────────────────┴──────────────┘
```

- Left rail: search, conversation list, new project, settings, server status.
- Center: one conversation. Header carries the bot identity and the conversation actions (archive, model, details).
- Right inspector: collapsed by default, toggled by button or `⌘B`. Tabs depend on the bot: Manager shows Tasks, Runs, Notes, Memory; Chief shows Goals, Tasks, Memory; Worker shows Runs and a diff summary.
- List order: needs-input first, then working, then most recent activity; the Chief is pinned above the sections.
- Sections: `Chief`, `Projects` (one row per Manager), and inside a Manager row, its live Runs as nested rows (indented, with a run state dot). Archived runs collapse into the Manager row.

### Platform adaptations

| Platform                | Shell                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS / Windows / Linux | Three panes. Native menu bar (macOS) with the same commands as the palette. Window material on macOS.                                                      |
| iOS / Android           | Two levels: list ⇄ chat. Inspector is a sheet from the header; the composer sits above the keyboard with safe-area insets. Swipe back returns to the list. |
| Web                     | Three panes above 1100 px, list+chat below. Keyboard shortcuts identical to the desktop apps.                                                              |

## 4. Message Blocks

One message renders as one or more blocks. The server decides order and ownership; the client decides only presentation.

| Block            | Content                                                                                                                              | Rules                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| User text        | plain text with markdown                                                                                                             | Optimistic echo only until the server snapshot arrives; then the server version replaces it (same `messageId`)                 |
| Assistant text   | markdown through NSH `TextView` (headings, lists, code, tables, mermaid where supported)                                             | Rendered incrementally during streaming, throttled to 20 Hz; never re-run a completed block's parse                            |
| Tool activity    | a folded group of tool calls for one round (Chief and Manager only): tool name, one-line argument summary, status, expandable output | Collapsed by default; errors auto-expand; grouped by round, not by tool; Worker tools never appear here                        |
| Progress card    | a Run's four phases on a rail (Understand, Edit, Verify, Report), one plain sentence, elapsed time, change stats                     | At most one per Run thread, updated in place; never show raw Worker output                                                     |
| Approval card    | a request that blocks the agent: destructive operation, missing credential, ambiguous decision                                       | Inline buttons `Allow` / `Deny` plus details; answers map to `resolveApproval` (new in v1)                                     |
| Notice card      | a user notice with severity and a link to the related Goal/Run/Task                                                                  | Dismiss inline; the client hides it locally (no server mutation in v1)                                                         |
| Run summary      | attempts, changed files, diff link, and `Land` / `Ship` / `Discard`                                                                  | One per completed Run; actions confirm with the target branch                                                                  |
| Memory candidate | an extracted memory with evidence and `Confirm` / `Confirm and select into Core` / `Revise` / `Reject`                               | Appears in the owning bot's chat; confirmation uses `memoryPromote` and activates the candidate before optional Core selection |
| Error            | command or streaming failure with a retry action                                                                                     | Never replaces the last good message                                                                                           |
| System           | scope change, model switch, archival, divider between sessions                                                                       | Low contrast, no actions                                                                                                       |

Rules:

- Streaming text appends; a revision increase replaces the whole message (the server's transcript is authoritative).
- A message id never changes. The client keys rows by `messageId`.
- Markdown links open in the system browser; in-app navigation is not supported in v1.
- Code blocks get copy and wrap toggles; long output is collapsed with a "show all" cap of 2000 lines.

## 5. Composer

- Multiline input. `Enter` sends, `Shift+Enter` inserts a newline on desktop; on mobile the keyboard's send key sends.
- While a turn streams, the send button becomes `Stop` (maps to `abort`). Typing during streaming is allowed; sending queues a follow-up and shows "Queued · 1" with the server's queue position.
- Model and thinking level: shown in the composer footer; changed through a popup (D13 semantics: per-conversation default, per-Run override when dispatching).
- Attachments: v1 supports text files and images. Every client opens a local picker (the share sheet on mobile), downscales images to a 2560 px long edge, and uploads the bytes with `uploadAttachment`; the server returns a path, and the message references it. `submit` stores those references on the message and returns them in snapshots; clients fetch the bytes with `readAttachment` and show a placeholder while offline. `listDirectory` is only for server-side project files, never the attachment source.
- Slash commands are not part of v1. The command palette covers actions.

## 6. Inspector

| Tab     | Content                                                   | Notes                                                                                      |
| ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tasks   | the scope's tasks: open, due, done; quick add             | Owner badges (user / agent)                                                                |
| Runs    | runs of the scope: state, attempts, branch, review state  | Row opens the Run thread or the diff                                                       |
| Notes   | project notes for the Manager's scope                     | Read-only in v1                                                                            |
| Memory  | memories for the scope: Core selection, candidates, usage | Read-mostly; candidate review uses Confirm / Revise / Reject, then optional Core selection |
| Details | scope, manager name, model, token usage, archive          | —                                                                                          |

Inspector state is per window and does not persist across launches in v1.

## 7. Secondary Surfaces

These lose their top-level tabs. Each is reachable from the command palette, from a card in a chat, or from the inspector.

| Surface                     | New home                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Goals                       | Palette (`Goals`), and a full-surface overlay over the chat area; the Chief's inspector shows active goals |
| Inbox                       | Slide-over panel from the header badge; per-scope badges; approvals open their conversation                |
| Skills                      | Settings → Skills (registry, versions, approvals); a pending approval also appears as a card in chat       |
| Memory                      | Inspector tab (already hidden from the tab strip today)                                                    |
| Usage                       | Settings → Usage (heatmap, per-model cost)                                                                 |
| Improvement log             | Settings → Improvements                                                                                    |
| Channels (Telegram, WeChat) | Settings → Channels                                                                                        |
| Service                     | Settings → Service (status, upgrade, logs)                                                                 |

The command palette (`⌘K`) is the escape hatch and the discovery surface: conversations, goals, tasks, skills, settings pages, and actions (`New project`, `New goal`, `Toggle inspector`, `Stop run`, `Land run`).

## 8. Unread, Notifications, and Attention

- The server owns read state (`markRead`). The list shows an unread dot and count per conversation.
- Three attention states drive ordering and the app badge: `needs input` (highest), `failed`, `done`. Working and idle do not notify.
- Desktop: native notification per attention state, coalesced per conversation; clicking focuses the conversation. In-app toast only for failures the user just caused.
- Mobile: in-app inbox in v1; push is an open question (see [clients.md](clients.md#10-open-questions)).
- A notification tap opens the exact conversation and scrolls to the latest message.

## 9. States

| State                        | UI                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Cold start                   | list skeleton, chat skeleton, no spinner on top of content                                         |
| Syncing                      | subtle header progress line; the list is interactive                                               |
| Reconnecting                 | banner "Reconnecting to Pi…" with the last sync time; composer disabled; cached read-only          |
| Offline / server unreachable | banner with the tailnet node name and a retry; read-only cache; a clear note that nothing was sent |
| Maintenance (server upgrade) | full-surface card: what is happening, expected time, retry                                         |
| Version mismatch             | blocking screen with the client and server versions and a link to update                           |
| Empty scope                  | one primary action (`New project` / `New goal`) and one example prompt                             |

## 10. Accessibility and Internationalization

- Roles, focus, and keyboard behavior come from `nsh/base` components. Lists are virtualized and keep one Tab stop; arrow keys move inside.
- Every icon-only control has an accessible name. Streaming text announces through `role="status"` at most once per second and never reads a whole message body.
- Focus order: list → chat → composer → inspector. `Esc` closes the innermost overlay; `⌘K` opens the palette from anywhere.
- Reduced motion: no streaming caret animation, no pane transitions, no parallax.
- Strings come from the existing key set (`src/renderer/i18n/en.ts`, Chinese in `zh.ts`); no copy is hardcoded in TSX. Chinese is a full override, not a partial translation.

## 11. Visual Language

- Tokens from the shadcn theme read by NSH (`theme.rs`: `neutral` by default), with the app's palette layered on top from [../design-language.md](../design-language.md).
- Chat typography: 15 px body, 1.7 line height, 720 px max text width (14 px on the phone); tool output in the monospace stack at 13 px.
- Components live in the TSX app on top of `nsh/base`; no component library is vendored from the React build. The React components (`src/components/ui`) are reference only.

## 12. Open Questions

1. Worker Runs: nested rows under the Manager (§3) or their own conversations? Nested is the default; revisit after the first long Run.
2. Attachments: which file types and size limits, and whether images are displayed from the server or uploaded to a CDN. v1: local picker, text and images stored on the server filesystem.
3. Approvals: which actions need an inline card versus a tool-level permission prompt? Start with destructive file/git operations and missing credentials.
4. Search: conversations only, or message text too? v1 ships conversation search; message search needs an FTS index on the server.
5. Does the list need a "Pinned" section beyond the Chief, or is recency plus needs-input ordering enough?
