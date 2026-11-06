# Tian Agent — NSH client (design fixture)

The first Native Shell build of the Tian Sky visual language (the design draft
`docs/design-language.md` and the interactive mockup
`docs/design/client-mockup.html` in the design change set on `main`). It runs on macOS and iOS with sample data:
the screen, copy, and interactions come from the mockup; it opens no socket and
calls no model.

This is a **design fixture**, not the server-first client. The implementation
gate in [`docs/nsh-migration.md`](../../docs/nsh-migration.md) is unchanged:
the protocol and UI specifications must land in `main` before the real client
is wired to Pi Server. This fixture exists so the visual language can be judged
natively, with the real fonts, motion, and AppKit text.

The iOS frontend uses `IOS.tsx`. See [IOS.md](IOS.md) for its screens, data boundary, commands, and asset generation. Both clients now use the latest SVG identities.

## Run

```sh
# Type check (writes .nsh/types with the NSH release's declarations).
nsh check

# Headless checks and in-process screenshots.
nsh test

# The app, with hot reload.
nsh run --target macos
```

`nsh 0.4.0` is the version this fixture was built and checked with. The entry
is `App.tsx`; `nsh.json` gives the app its id and system appearance.

## What is implemented

| Area          | State                                                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window        | 1336 × 812, hidden system title bar (52 pt drag strip and native traffic lights), three panes: 284 + fluid + 404                                                                                                            |
| Sidebar       | Search (`⌘K`), pinned Chief card with ambient light, Manager rows with planets and moons, live Runs, server footer, theme toggle                                                                                            |
| Conversations | Chief (greeting, status table, screenshot, delegation, run summary, streaming answer), Atlas (code, run summary, two progress cards), Juno (approval), Vega (empty state)                                                   |
| Inspector     | Changes (file list, native `DiffView`, review note, Land / Ship / Discard), Tasks, Details                                                                                                                                  |
| Composer      | Multiline input, screenshot suggestion, model chip, Enter to send, Shift-Enter for a line break; sent messages append                                                                                                       |
| Settings      | Bands by owner; Appearance (theme, glass, pointer light, ambient light, reduced motion, text size, code wrap), Capture, Notifications, General, Model, Providers, Workers, Skills, Server, Channels, Usage, Improvement log |
| Overlays      | Command palette (`⌘K`), Settings (`⌘,`), Escape closes the top overlay; application menu with shortcuts                                                                                                                     |
| Appearance    | Night and day tokens from `docs/design-language.md`; system appearance is followed when selected; reduced motion stops animations                                                                                           |

All data is fixed sample data in `data.ts`. Controls update their local state
(theme, density, settings pages, migration choice, composer) but write nothing
outside the app.

## What is not implemented

- Pi Server connection, authentication, or a transport. There is no socket,
  no protocol client, and no local resident service.
- Screenshot capture, file attachments, diff landing, memory, notifications,
  login, the menu bar extra, distribution signing, and updates. The iOS frontend and simulator packaging are implemented; server integration remains separate.
- Manager hue assignment and iOS app-extension support remain open questions
  in the design document.

## Files

| File            | What                                                                |
| --------------- | ------------------------------------------------------------------- |
| `App.tsx`       | Window, application menu, theme appearance, shell and overlays      |
| `theme.ts`      | Night and day tokens, the dawn gradient, identity hues              |
| `state.ts`      | Client signals (selection, inspector, settings, draft, preferences) |
| `data.ts`       | Sample managers, runs, diff, tasks, and settings rows               |
| `fonts.ts`      | Geist, Geist Mono, Instrument Serif, Phosphor (OFL, latin subsets)  |
| `ui.tsx`        | Identity glyphs, cards, buttons, labels, rail, dots                 |
| `blocks.tsx`    | Message blocks: Markdown, cards, progress phases, approval          |
| `Sidebar.tsx`   | Conversation list, Manager rows, footer                             |
| `Chat.tsx`      | Conversation header, threads, composer mount, scroll behaviour      |
| `Composer.tsx`  | Input, suggestion, model chip, send                                 |
| `Inspector.tsx` | Tabs, file list, `DiffView`, actions                                |
| `Settings.tsx`  | Bands, pages, rows, switches, sliders                               |
| `Palette.tsx`   | Command palette                                                     |

## Verification

The fixture passes `nsh check`, `nsh build`, and the tests in `App.test.tsx`.
Screenshots from an in-process test render (`nsh test` with
`app.screenshot(...)`) were used to compare against the mockup; in-process
screenshots do not show backdrop blur or outer shadows, so the glass layers
look flatter there than on screen.
