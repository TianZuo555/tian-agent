# Tian Sky — an NSH web demo

An interactive web build of the two design mockups:

- [client-mockup.html](../client-mockup.html) — glow finish
- [client-mockup-no-glow.html](../client-mockup-no-glow.html) — matte finish

The app is written in TSX and rendered by [NSH (Native Shell)](https://nsh.dev):
the Rust engine, layout and text run as WebAssembly, and the page draws the
interface as HTML and CSS.

Sample data only. There is no server and no model call; sending a message adds
it to the current conversation in memory.

## Language

The copy is the Chinese sample of the mockups
([`client-mockup.html`](../client-mockup.html), `lang="zh-CN"`), kept as an
example of the zh locale ([design-language.md §12](../design-language.md#12-iconography-and-accessibility)).
It is demo content, not the client's shipped UI: production strings live in
`src/renderer/i18n/en.ts` with `zh.ts` overrides, and this folder does not
duplicate that dictionary. English users see the visual design through the
same sample copy as the mockup.

## Run

Requires `nsh` 0.4.0 (`nsh -V`).

```sh
cd docs/design/nsh-demo
nsh run --target web
```

Open the printed address. An edit to the TSX reloads the page.

## Publish

```sh
nsh package --target web     # .nsh/out/Tian Sky/
```

The output is a static site; serve that directory from any static host. The
page needs no network at run time.

## What the demo covers

| Area        | Content                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS       | Sidebar (Chief and three Managers, mini runs, server footer), four conversations, composer, inspector (changes, tasks, details), Juno's decision, Vega's idle state        |
| Settings    | Ten panes: 外观, 通用, 模型, 提供方, Worker 与 Intent, 技能, 服务器与设备, 渠道, 用量, 改进日志                                                                             |
| iOS         | Five screens: home, Chief chat, Atlas chat, run review, settings                                                                                                           |
| Components  | Elevation stage, surface ladder, identities, states, buttons and inputs, message blocks, loading, overlays                                                                  |
| Theme       | Night and day, each in a glow or matte finish; the finish toggle switches the two mockups                                                                                  |

Interactions: switch conversations, send a message, toggle the inspector,
switch its tabs, approve Juno's decision, walk the settings panes, switch the
theme.

## Not included

The “设计说明” (design notes) tab. It is prose documentation for the mockups,
not part of the client.

## Files

| Path                      | Contents                                                       |
| ------------------------- | -------------------------------------------------------------- |
| `App.tsx`                 | Root: demo chrome, the three tabs, the theme signals           |
| `theme.ts`                | Night/day and glow/matte tokens, the live theme proxy          |
| `data.ts`                 | Sample conversations, runs, diff, settings, kit copy           |
| `ui.tsx`                  | Icons (Canvas), avatars, dots, rails, text atoms               |
| `MacView.tsx`             | The desktop window: sidebar, chat, inspector, settings overlay |
| `mac/Sidebar.tsx`         | Conversations and server footer                                |
| `mac/Chat.tsx`            | The four conversations, message blocks, composer               |
| `mac/Inspector.tsx`       | Changes, tasks, details, Juno's decision, Vega's idle state    |
| `mac/Settings.tsx`        | The settings dialog and its panes                              |
| `phone/PhoneView.tsx`     | The five phone screens                                         |
| `kit/KitView.tsx`         | The component gallery                                          |

## Assets

- Avatars: copied from [`docs/design/avatars`](../avatars) (the raster identity
  study).
- Fonts: Geist, Geist Mono and Instrument Serif from Google Fonts, under the SIL
  Open Font License. See [`assets/fonts/README.md`](assets/fonts/README.md).

## Notes for maintainers

- NSH runs a component once. A JSX expression that reads a signal updates; a
  constant computed in the component body does not. The theme is a proxy
  (`live` in `theme.ts`) so every `style={{ color: t.text }}` reads `mode()` and
  `finish()`. Derive values from props inside JSX, not in the body.
- `key` is not an element prop. Render arrays with the `For` helper (`ui.tsx`)
  or `Each`.
- `numberOfLines` belongs in the text style (`style={{ numberOfLines: 1 }}`),
  not in props.
- The folder is excluded from the repository's oxfmt and oxlint configs: it is
  an NSH app with its own compiler and formatting, not part of the Electron
  renderer.
