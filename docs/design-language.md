# Visual Language: Tian Sky

**English** | [简体中文](zh/design-language.md)

Status: Accepted as [D23](decisions.md#d23--tian-sky-visual-language-for-the-native-shell-clients), 2026-11. Applies to the Native Shell (NSH) clients: macOS and iOS first. The interactive mockup is [`docs/design/client-mockup.html`](design/client-mockup.html); open it in a browser. It has four tabs (macOS, iOS, Components, Design notes), a day/night switch, and sample data only.

The Electron client keeps the previous ink-monochrome language until it is removed. That version of this document is in git history at `bb98e08`.

## 1. Principle

**One Chief, a few stars.** The interface itself is ink and paper. Colour and light belong only to identity and state. Every animation reports a state; nothing moves for decoration.

- The conversation is the interface. Delegation, progress, review, and decisions appear as cards in the thread.
- Workers report phases, not logs. The raw CLI stream never reaches the UI.
- Artifacts are first-class. A screenshot reaches a conversation in one step; a diff can be landed from the phone.

## 2. Identity

The current identities are the [animated SVG characters](design/avatars-svg/README.md): Chief is a sun with detached rays; Atlas is Earth with glasses; Juno is Saturn; Vega is a banded planet with a beret. Both mockups use these characters. The table below records the original orbital treatment; the SVG characters replace those glyphs. Their 25 presentation states keep each identity colour unchanged. Worker moons and written presence lines remain. Surface lighting, glass, and elevation follow §4.

| Role    | Shape                | Colour                           | State is shown by                                                                                                         |
| ------- | -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chief   | Orb                  | The dawn gradient (the only one) | Spin speed and halo: idle 14 s/turn, thinking 2.6 s + dashed halo, waiting amber halo, offline grey and still             |
| Manager | Planet with an orbit | One identity hue per project     | Moons: one per running Run. Waiting: the core pulses. Blocked: the hue turns coral and the orbit stops. Idle: desaturated |
| Worker  | Moon on its Manager  | The Manager's hue                | Present while the Run executes; gone when it ends. No name, no avatar                                                     |

Identity hues in the mockup: `--atlas #5ee6c9`, `--juno #ffc25c`, `--vega #a99bff`. A hue identifies a Manager; it never encodes state, except the temporary coral for "blocked".

## 3. Colour

Surfaces are achromatic. Only three colour families exist, plus diff lines.

| Family   | Tokens                                              | Use                                                                                  |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Dawn     | `--dawn: #ffb86b → #ff6f91 → #8b7cff` (135°)        | The Chief orb, the send button, the streaming caret, the focus ring, progress sweeps |
| Identity | `--atlas`, `--juno`, `--vega`, …                    | Manager planets and their moons                                                      |
| State    | `--work` (teal), `--wait` (amber), `--fail` (coral) | Status dots, halos, banners                                                          |
| Diff     | `--add`, `--add-bg`, `--del`, `--del-bg`            | Added and deleted lines only                                                         |

Surface tokens per theme:

| Token                     | Night                             | Day                               |
| ------------------------- | --------------------------------- | --------------------------------- |
| `--page`                  | `#06070b`                         | `#ece8e1`                         |
| `--win` (window, glass)   | `rgba(14,16,23,.80)`              | `rgba(253,251,247,.82)`           |
| `--card`                  | `rgba(255,255,255,.045)`          | `rgba(255,255,255,.78)`           |
| `--line` / `--line-2`     | white 8% / 15%                    | ink 9% / 17%                      |
| `--text` / `-2` / `-3`    | `#eeece6` / `#a9a8b3` / `#6f6f7d` | `#15161b` / `#5c5d68` / `#9898a3` |
| `--bubble` (user message) | `#eeece6` on `#111217`            | `#15161b` on `#f4f2ed`            |

Rules:

- At most one solid inverted button per screen. The dawn gradient appears only in the places listed above.
- Success is not green. "Done" is the secondary text colour with a check.
- A failure never flashes. Only "working" animates.

## 4. Light and Elevation

There is **one light source: the Chief**, at the top left (where the Chief sits in the sidebar and on the phone home screen). Everything else reflects light; nothing else emits it, except status lights and the focus ring.

| Level      | Use                                   | Surface                           | Light                   |
| ---------- | ------------------------------------- | --------------------------------- | ----------------------- |
| L0 Sky     | Desktop, page background              | `--wall`: gradient + colour pools | —                       |
| L1 Pane    | Window, sidebar                       | `--win`, blur 50, saturate 1.5    | `--rim-strong`          |
| L2 Card    | Message cards, lists, settings groups | `--card`, 1 px `--line`           | `--rim`, no drop shadow |
| L3 Float   | Composer, menus, popovers, toasts     | `--glass`, blur 24                | `--rim-strong` + `--e3` |
| L4 Overlay | Capture HUD, sheets, command palette  | `--glass`, blur 30                | `--rim-strong` + `--e4` |

- **Rim light** (`--rim`, `--rim-strong`): a 1 px inner highlight on the top edge, as if light grazes the glass from above. Night `rgba(255,255,255,.07)`; day `rgba(255,255,255,.9)`.
- **Drop shadows** belong only to things that float (L3, L4). Cards never get one. Shadows point away from the light: down and to the right. Night shadows are black; day shadows are tinted dusk violet (`rgba(60,40,80,.32)`), never neutral grey.
- **Ambient light** (`--sun`): the Chief orb casts a warm radial glow (about 220 px, at most 22% alpha) on the surface behind it. Used on the Chief row, the window's top-left corner, the phone home screen, and the lock screen.
- **Pointer light** (`--spot`): on hover, a 280 px soft light follows the pointer over a card. Pointer devices only.
- **Glass**: floating controls on iOS 26 / macOS 26 use NSH `glassEffect` (the system Liquid Glass); older systems fall back to backdrop blur. Content scrolls underneath.
- **Glass intensity** (Settings → Appearance): 0 makes every surface opaque. Honour the system's reduce-transparency setting and low-power mode the same way.
- No more than three levels on one screen.

## 5. Typography

| Role              | Face                                     | Size                                         |
| ----------------- | ---------------------------------------- | -------------------------------------------- |
| Display           | Instrument Serif; Songti SC for Chinese  | 24–64 px; greetings, page titles, Chief name |
| UI and body       | Geist; PingFang SC for Chinese           | Chat 15 px / 1.7 (phone 14 px), UI 12–14 px  |
| Data and metadata | Geist Mono                               | 9.5–12 px; ids, times, models, paths         |
| Section labels    | Geist Mono, uppercase, `0.12em` tracking | 10 px                                        |

Message text is at most 720 px wide. The 15 px / 1.7 chat size is fixed by D23 and replaces the 16 px / 1.5 in the draft `docs/spec/ui.md` §11.

## 6. Geometry

Radii: buttons 10, chips and pills 999, cards 18, composer 22, window 16, phone sheets 40. Dividers are 1 px `--line`; layout gaps never fake a line.

**Selection uses fill only.** Selected rows (settings navigation, the diff file list, command-palette results, conversation rows) get a `--card` or `--card-2` fill. They do not get a left accent bar.

## 7. Components

Every component below has a specimen in the mockup's Components tab or in a screen.

| Component            | Specification                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar              | Search (`⌘K`), the Chief card pinned on top with ambient light, then one row per Manager: planet, name, project, presence line. Live Runs nest under their Manager as mini rails. Footer: server status and the Settings gear.                                                        |
| Conversation header  | Identity glyph, name, presence line (state · scope · model · thinking), actions. Solid `--win-solid` with a 28 px fade below.                                                                                                                                                         |
| User message         | Solid inverted bubble, radius 20/20/6/20, right-aligned, attachments above the text.                                                                                                                                                                                                  |
| Agent message        | No bubble. Author line (name, mono time), then a Markdown document: serif `h3`, mono list markers, tables in a rounded frame, code blocks with copy.                                                                                                                                  |
| Delegation card      | Chief orb → Manager planet, task title, attachments, "Open Manager".                                                                                                                                                                                                                  |
| Progress card        | One per Run, updated in place: four phases (Understand, Edit, Verify, Report) on a rail, one plain sentence, elapsed time, change stats, a 2 px top sweep. "Steps" disclosure shows at most 8 milestones.                                                                             |
| Run summary          | Check badge, branch, stats grid (files, lines, tests, attempts), View changes / Land / Ship / Discard.                                                                                                                                                                                |
| Approval card        | Amber tint, the exact action, radio choices with consequences, Approve / Ask more / Reject. Rejection is final for that action.                                                                                                                                                       |
| Tool activity        | Chief and Manager tool calls folded per round; collapsed by default, auto-expanded on error. Worker tools never appear here.                                                                                                                                                          |
| Thinking             | A shimmering "Thinking · 4 s" while active; folds to one line above the answer.                                                                                                                                                                                                       |
| Notice card          | Severity icon, related object, Done / Dismiss / Open.                                                                                                                                                                                                                                 |
| Memory candidate     | Statement, kind, scope, quoted evidence; Confirm / Confirm and select into Core / Revise / Reject.                                                                                                                                                                                    |
| Error                | Coral border. Never replaces the last good message. Retry reuses the same `requestId`.                                                                                                                                                                                                |
| System divider       | Centered mono text between hairlines; no actions.                                                                                                                                                                                                                                     |
| Composer             | L3 glass. Rows: screenshot suggestion, attachments, text, tools (attach, capture, model chip, hint, send). States: idle; streaming (send becomes Stop with a breathing ring, typing continues, "Queued · 1"); offline (reason line, disabled send, "nothing was sent").               |
| Screenshot capture   | macOS: `⌥⇧S` opens the system region picker, then an L4 HUD: target (Chief or a Manager), optional note, Return to send. Composer chip "Just captured" for screenshots under 5 minutes old; upload only on "Attach". iOS: the share sheet "Send to Tian" with the same two questions. |
| Diff                 | NSH `DiffView`. macOS: in the inspector with a file list and sticky Land / Ship / Discard. iPhone: full screen, unified only, no wrap, files in a horizontal pager. A line note becomes a follow-up to the Run (a new Attempt). Large files load on demand.                           |
| Inspector            | Right pane on macOS (Changes / Tasks / Details); a sheet on iPhone.                                                                                                                                                                                                                   |
| Popovers             | Model picker (model list + thinking level, "applies to this conversation"), command palette (`⌘K`, grouped results, matched text underlined in dawn pink).                                                                                                                            |
| Notifications, toast | Native notification for waiting, failed, done. Toast only for the user's own action.                                                                                                                                                                                                  |
| Connection states    | Syncing: 2 px dawn sweep under the header. Reconnecting: amber banner with the last sync time. Offline: coral banner with the node name. Cold start: skeleton shaped like the content; no spinner over content.                                                                       |
| Settings             | See §9.                                                                                                                                                                                                                                                                               |
| Lock screen (v2)     | iOS Live Activity: the running Run, its phase rail and elapsed time.                                                                                                                                                                                                                  |

## 8. Worker Phases

The server derives the phase from Worker tool calls with fixed rules, without a model call. The client receives only the phase, one sentence, elapsed time, and change stats.

| Phase      | Tool calls                                       |
| ---------- | ------------------------------------------------ |
| Understand | `read`, `grep`, `find`, `ls`                     |
| Edit       | `edit`, `write`, patch tools                     |
| Verify     | `bash` running test, lint, or typecheck commands |
| Report     | Writing the Run report; the Attempt ends         |

A phase can move back (a failed test returns to Edit). "Waiting for input" and "failed" notify the user; "working" never does.

## 9. Settings

macOS: a full-window overlay from the gear or `⌘,`; `Esc` closes it and returns to the previous view. iPhone: a grouped list. The band names state who owns each setting.

| Band       | Owner                               | Pages                                                |
| ---------- | ----------------------------------- | ---------------------------------------------------- |
| Agent      | The account; shared by every device | Model, Providers, Workers and Intents, Skills        |
| Personal   | This device only                    | General, Appearance, Capture, Notifications          |
| Operations | The server                          | Server and devices, Channels, Usage, Improvement log |

- Appearance holds the light controls: theme (system / night / day), glass intensity, pointer light, Chief ambient light, reduced motion, chat text size, code wrap.
- Capture holds every capture entry: shortcuts, the "Just captured" suggestion and its time window, the default target, downscaling before upload (long edge 2560 px), and the system permission state.
- Notifications switch per state; "working" is fixed off. The Chief's proactive messages have three levels: off, fewer, more.
- Server and devices lists paired devices with per-device revoke, and the local cache size with Clear.
- Provider keys live on the server; the client shows only the last characters.

## 10. Motion

| Motion                 | Value                                     |
| ---------------------- | ----------------------------------------- |
| Orb spin               | 14 s idle; 2.6 s thinking                 |
| Halo breathe           | 4.2 s; 1.6–1.8 s when thinking or waiting |
| Status ping (`--work`) | 2 s                                       |
| Progress sweep         | 2.4 s linear                              |
| Moon orbit             | 7 s linear                                |
| Message arrival        | 360 ms: opacity, 8 px rise, 2 px blur     |
| HUD and settings enter | 240–300 ms                                |
| Inspector toggle       | 320 ms column transition                  |
| Easing                 | `cubic-bezier(0.22, 1, 0.36, 1)`          |

Under reduced motion every animation stops and state is shown by colour only. No bounce, no parallax, no entrance longer than 400 ms, and motion never blocks input.

## 11. Platforms

| Platform | Shell                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Three panes (sidebar 284 px, conversation, inspector 404 px). Menu bar extra: Chief state, Worker count, capture entries. Window material with the Chief's ambient light at the top left. |
| iOS      | Two levels: list and conversation. Glass header and floating glass composer; the thread scrolls underneath. Inspector and settings detail as sheets or pushed pages.                      |

## 12. Iconography and Accessibility

- Phosphor stays the only icon set. The mockup draws simplified stand-ins.
- Every icon-only control has an accessible name. Decorative glyphs (orbs, planets) are `aria-hidden`; their state is also written in the presence line.
- Status changes are announced at most once per second; a streamed message body is never read in full.
- Strings live in `src/renderer/i18n/en.ts` with `zh.ts` overrides. The mockup shows Chinese copy as an example of the zh locale.

## 13. Anti-patterns

- No second gradient. No neon glow outside the Chief orb and status lights.
- No drop shadow on cards. No shadow that points toward the light.
- No left accent bars for selection.
- No colour for decoration: every hue is identity, state, or diff.
- No raw Worker output in the UI, and no diff in a modal on macOS.
- No animation that does not report a state.

## 14. Open Questions

1. Manager hues: assigned automatically, or chosen at project registration.
2. Whether NSH supports iOS app extensions (Share Extension, Live Activity).
3. The draft `docs/spec/ui.md` §11 (branch `docs/server-first-spec`) still says 16 px / 1.5; update it to 15 px / 1.7 when the spec lands.

## References

- [docs/research/persistent-agent-ui.md](research/persistent-agent-ui.md): Grok Bot, Muse, and DS Bot.
- NSH: `TextView` (Markdown), `DiffView`, `glassEffect`, and `nsh/base` components (`nsh.dev`).
- [Phosphor Icons](https://phosphoricons.com/).
