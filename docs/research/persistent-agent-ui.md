# Persistent-Agent Client Design: Muse, Grok Bot, and DS Bot

**English** | [简体中文](../../zh/research/persistent-agent-ui.md)

Research Date: 2026-11-05. Research only. This document records design analysis and recommendations. It does not change [docs/prd.md](../prd.md) or [docs/decisions.md](../decisions.md).

## Conclusions

1. **The agent is the object; the conversation is its interface.** Grok Bot and DS Bot replace the chat history with a roster of named agents. Muse takes the opposite bet: one long conversation, with side chats for separate topics. Tian Agent sits between them, with one Chief and one Manager per project. Do not add a user-defined agent roster. Do make each Manager a stable row with a name, a presence line, and a last-activity time.
2. **Presence belongs on the row, not in a panel.** Grok Bot carries six agent states in the avatar itself. Muse shows one line of current work under the avatar. Tian already stores the data, but the user must open Context → Runs to see it. Add one presence line per conversation row, fed by Run status and pending work.
3. **Approvals belong in the transcript as a card.** Muse's checkout card is the clearest example: a preview, the amount, the payment method, and Deny / Allow, inline. Tian's approval feature (M3) has no UI. Build the card in the thread and a review state in the row. Do not build a separate approvals page.
4. **Do not copy the colored avatar system.** Tian's [visual language](../design-language.md) is monochrome ink with Phosphor icons, and the brand color is reserved for active state. Borrow the structure, not the art: identity is a name, a role glyph, and a motion state.
5. **Visibility has three levels: status, preview, takeover.** Grok Bot designed all three and deliberately refused a fourth (side-by-side). Tian has preview (Context pane) and a stop button. It has no always-on status and no takeover path.
6. **Reject three patterns.** Agent group chats, user-authored routines as first-class objects, and a remote agent desktop. Each is a large product with its own cost, and Tian's existing model covers the same need more narrowly (Manager ↔ Worker messages, Goal Schedules, worktrees and diffs).

## Evidence and Limits

Read: the xAI design essay «Designing Grok Bot for a world of persistent agents» and launch post; Meta's «How We Designed Muse» and the September 2026 release post; the DS Bot README and an independent product summary; one accessibility review of Muse; the Grok Bot App Store listing and a Cursor forum feature request that exposes the desktop info-pane structure.

Seen as images: six Muse App Store frames, four Grok Bot App Store frames, eight DS Bot phone screenshots. These show the phone clients only.

Not verified: desktop clients, real latency, pricing, VoiceOver behavior beyond the one review, and every screen not in the frames. DS Bot is a community project, not a DeepSeek product.

## The Three Products

| | Muse (Meta) | Grok Bot (xAI) | DS Bot (community) |
| --- | --- | --- | --- |
| Primary object | One main chat, plus side chats | Roster of Bots | Roster of Bots, plus group chats |
| Agent runtime | Cloud VM per user, with a sentinel process | Cloud computer per Bot | The user's own DeepSeek Harness host |
| Coordination | One agent with sub-work | A coordinating Bot routes to specialist Bots; group threads | A Chief Bot manages the other Bots; group admin and @-mentions |
| Cost control | Approval cards before send or spend | Approval only when a decision needs the user | Per-Bot model choice; usage page by Bot and model |
| Release | Consumer, September 2026 | Beta, September 2026 | Open source, Apache-2.0, October 2026 |

## Screen by Screen

### Home and Navigation

**Grok Bot.** The home screen is the Bot roster. Each row is an avatar, a name, a last message, and a time. The conversation header centers the Bot's name and puts the computer control in the top-right corner. The Bot info pane (Command-Shift-I) carries three tabs: Details, Media, and Computer.

**Muse.** The home screen is the conversation. A centered avatar and name sit at the top, and a menu button opens the rest. Goals, activity, and ideas are separate destinations rather than peers of the chat.

**DS Bot.** The home screen is a Bot list with a last-message preview and an unread dot. Group rows show two overlapping avatars. The header holds settings, search, and a plus button.

**Tian today.** `Sidebar.tsx` groups conversations by scope and pins the Manager first. The scope folder and the conversation rows carry equal visual weight, so the internal structure (Global, projects, Chief, Manager) is visible as a file tree.

**Recommendation.** Keep the scope grouping: it matches Goals, Tasks, and memory ownership, and the reference products have no equivalent. Change the weight:

- The Manager row becomes the scope's person row: a role glyph, the Manager name, and a presence line.
- Other conversations fall back to title plus relative time, as today.
- Show the active scope's Manager in the window title area, the way Muse centers its agent.

### Creating an Agent

**Grok Bot and DS Bot.** Both use one screen: a large avatar preview, a name field, a shape grid, and a color grid. Grok Bot offers eight shapes and ten colors; DS Bot offers fifteen and ten. Creation takes seconds and needs no explanation.

**Tian today.** The Manager name is required when a project registers (`AddProjectDialog`), and the project dialog holds the rest of the settings.

**Recommendation.** Nothing to build. Identity is already captured at the correct moment. If Tian later adds a role glyph per Manager, take it from Phosphor, not from an avatar generator.

### Conversation

**All three use bubbles, not a flat document.** Muse states the reason: proactive messages arrive out of turn, users send several messages in a row, and an unbounded flat transcript stops being readable. Grok Bot fills user bubbles dark and agent bubbles light grey, with no per-message avatars in a one-to-one thread.

**DS Bot** collapses the reasoning above the answer as «Thought process». **Grok Bot** turns actions into inline objects: a created Routine, a message to another Bot, or an email draft becomes a compact card in the timeline. Muse attaches a PDF card and an order card the same way.

**Tian today.** `ChatView.tsx` renders a document-style transcript with tool rows and `notice` rows. Notices already appear in the thread, which is the same move Grok Bot makes for system events.

**Recommendation.** Keep the document transcript; it suits long reports and diffs. Add two things:

- Attribution when more than one voice shares a thread (Tian, Chief, Manager). Today the thread is implicitly one speaker.
- Structured cards for approval, choice, and form events, instead of prose notices.

### Activity and Presence

**Grok Bot** carries six states in the avatar: idle, thinking, working, waiting, blocked, done. Motion, not a badge, distinguishes them. A hover shows the current step. The design post records the reason: users who saw one step wanted all steps, and the need was reassurance that work had not stalled.

**Muse** shows a snippet of current work under the avatar. Tapping the avatar opens the full activity log and the list of approved permissions.

**Tian today.** `ContextPane.tsx` shows Tasks, Runs, and Memory for the active scope. The Runs panel lists Run rows. `RunInfo` already carries `runtime`, `model`, `thinkingLevel`, `status`, and `attempt`, but the panel does not show the runtime or the model. Live step detail (`run-progress.ts`) never reaches the renderer.

**Recommendation.** Two layers, in this order:

1. A presence line on the conversation row: «running task X, attempt 2», «waiting for approval», «blocked since 14:20». Source it from the existing conversation and run snapshots.
2. A step feed in the Runs panel, once `run-progress` is sent to the client. Add `runtime` and `model` to the Run row now: the data is already in the payload.

### Approvals

**Muse** puts a full card in the transcript: title, the site, a verification sentence, a merchant preview, «Review order», the payment method, the estimated total, and Deny / Allow. The same release notes structured approval cards as one of the few places where conversation is not enough, and warns about banner blindness: a UI that asks constantly trains the user to approve without reading.

**Grok Bot** makes «only come back when something needs your approval» a product promise. The design post says the Bot's computer stays the Bot's workspace; the user takes control only when asked.

**Tian today.** The `approvals` table exists on a branch, and Review (Land, Ship, Discard) is a UI action. Neither has a dedicated surface; the vocabulary already separates Approval from Review ([CONTEXT.md](../../CONTEXT.md)).

**Recommendation.** Build the approval as a card in the thread, with three parts: the exact action and target, the digest or diff that the user can inspect, and Deny / Allow. Record the decision as an event. Add a pending count on the conversation row. Do not add an approvals page: it separates the decision from the context that explains it.

### Artifacts and Structured Output

**Grok Bot** treats the form of an answer as part of the answer: a forecast becomes a chart, a task set becomes a board, an email becomes a draft card with Send and Discard.

**Muse** calls its durable outputs Artifacts. They travel through chat and can live outside it.

**Tian today.** Run reports are Markdown files under `.tian/runs/`, surfaced through `read_run_report` and the report view. Diffs render through Pierre.

**Recommendation.** Do not build an artifact system yet. Do make the report and the diff reachable from the Run row in one click, so the output stops being a file the user has to find.

### Capabilities

**DS Bot** separates Skills, Plugins, Connectors, and Capabilities into one settings group and attaches each per Bot. **Grok Bot** puts plugins at the account level and keeps memory and routines with the Bot, with the rule that capabilities can be shared while context stays with the role. **Muse** lists connectors as Connected and Available, each with a one-line scope.

**Tian today.** Settings → Providers and Settings → Workers hold model and runtime configuration. Project settings hold `promptPreamble` and `default_intent`.

**Recommendation.** Adopt Grok Bot's rule as wording in the UI: capabilities (providers, runtimes, intents) are account-level; context (memory, notes, schedules) belongs to the scope. The current split already follows the rule, but the labels do not say so.

### Settings

**DS Bot** groups settings as identity and usage, Tools and skills, Bot (Bots and groups, Scheduled tasks, Classic Agent mode, Bot computer), and Preferences (Notifications, Appearance).

**Tian today.** `SettingsView.tsx` has eight sections: General, Appearance, Model, Providers, Workers, Usage, Improvement log, Service, Channels. Channels is missing from the list in the code but present in the message keys.

**Recommendation.** Group the eight into three bands: agent (Model, Providers, Workers), personal (General, Appearance), and operational (Usage, Improvement log, Service, Channels). Keep every section reachable; the change is navigation, not content.

### Proactivity and Notifications

**Muse** sets a high bar for proactive messages, offers a dial (off, lower, higher), and keeps every proactive message in the main thread. **Grok Bot** moved Routines from configuration into the Bot's main interface after research showed they carry real work.

**Tian today.** Schedules live on Goals, and `notify_user` deduplicates within 24 hours. Notices render in the thread. The Inbox view holds deliveries across scopes.

**Recommendation.** Keep Schedules under Goals; that model is narrower and cleaner than Bot-level routines. Show the next fire time on the Goal card, which `NavViews.tsx` already does, and add an unread marker on the conversation that received a notice.

## Gap Map

| Screen | Tian today | Pattern worth taking | Cost |
| --- | --- | --- | --- |
| Sidebar | Scope tree, Manager pinned | Manager as person row with presence | Small |
| Conversation header | Title, model picker | Centered agent identity, status control | Small |
| Transcript | Document plus notice rows | Speaker attribution, structured cards | Medium |
| Context → Runs | Run list, no runtime or model | Runtime, model, thinking, step feed | Small, then medium |
| Approvals | None | Inline card with digest and Deny / Allow | Large |
| Run output | Report file and diff view | One-click reach from the Run row | Small |
| Settings | Eight flat sections | Three bands, rule for capabilities vs context | Small |
| Proactivity | Goal schedules, deduped notices | Next fire time, unread marker, dial | Small |

## Recommended Order

1. **Run row and presence line.** Cheapest useful change. It uses data the client already has, and it fixes the «is it working?» question that both Grok Bot and Muse designed around.
2. **Structured approval card.** It unblocks M3 and sets the card pattern for later events.
3. **Conversation header identity.** It prepares the NSH client and costs little in the current React app.
4. **Settings bands.** Pure navigation work, no behaviour change.

## Rejected Patterns

| Pattern | Why not |
| --- | --- |
| User-created agent roster | Tian's roles are fixed by the architecture (Chief, Manager, Worker). A free-form roster would duplicate projects and Goals with a weaker model. |
| Agent group chats | Tian already routes work through Manager ↔ Worker messages and Chief ↔ Manager reports. A shared thread would add a second, competing channel. |
| Remote agent desktop | Tian's unit of work is a Git worktree and a diff. Add a live computer view only if computer use becomes a product decision ([todo-computer-use.md](../todo-computer-use.md)). |
| Flat chat without bubbles | Tian's transcript carries long reports. Bubble-first would compress them; speaker attribution is the part worth taking. |
