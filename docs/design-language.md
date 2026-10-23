# Visual Language: Ink Surfaces and Monochrome Accents

**English** | [简体中文](zh/design-language.md)

The visual design builds upon Coder design tokens and the three-pane desktop shell of Codex and Cursor. It layers a distinct identity: **ink surfaces, monochrome black and white accents, Phosphor iconography, and restrained motion**. Visual elements must show active state rather than distract the user.

## Why Coder and Phosphor

Coder is an open-source development tool with clean theme tokens (`site/src/theme/`). Its aesthetic suits long coding sessions: **dark palettes, flat surfaces, minimal shadows, and monochrome accents**.

Iconography standardizes on [Phosphor Icons](https://phosphoricons.com/). The library provides consistent 256-unit grids and six weights. The system defaults to `bold` for clarity at 12–16px sizes, uses `fill` for selected states, and applies `duotone` for empty states. No secondary icon libraries are permitted. Markdown code blocks and table tools override their icons with Phosphor.

## Color

### Three Token Layers

Coder structures colors into three semantic layers:

| Layer   | Variables                                                                      | Usage                  |
| ------- | ------------------------------------------------------------------------------ | ---------------------- |
| Content | `--content-primary/secondary/disabled/invert/link/success/warning/destructive` | Typography and icons   |
| Surface | `--surface-primary/secondary/tertiary/quaternary/control/invert-primary/...`   | Backgrounds and panels |
| Border  | `--border-default/secondary/control/destructive/success/warning/sky`           | Dividers and strokes   |

Tokens store raw HSL channels (`240 4% 16%`). The `@theme inline` block formats them into `hsl(var(--border-default))`. This allows applying alpha channels directly (`bg-surface-secondary/50`) without creating single-purpose tokens.

Standard UI variables like `--background`, `--foreground`, and `--muted` act as aliases pointing to these semantic tokens.

### Monochrome Accents

Accent tokens remain strictly achromatic:

- `--brand`: Deep ink `240 6% 10%` (light mode) / Bright white `0 0% 98%` (dark mode)
- `--brand-2`: Mid grey `240 5% 42%` / `240 4% 72%`
- `--brand-contrast`: Inverted text, light `0 0% 100%`, dark `240 10% 4%`
- `--brand-soft`: Subtle grey for soft selections
- `.bg-brand-gradient`: 135° gradient from `brand` to `brand-2`, used only on brand marks, send buttons, and progress indicators
- `.shadow-brand`: Soft dark shadows reserved for brand marks and primary buttons

Links, focus rings, selected navigation pills, and active status indicators all resolve to `--brand`. Semantic colors remain minimal: warning (`38 75% 66%`) and destructive (`0 60% 66%`). Success states remain monochrome using text and check icons. Only code diff views use green and red lines.

### Color Rules

- Black and white gradients apply only to small key anchors: brand marks, send buttons, and progress meters. Backgrounds and panels stay flat.
- A maximum of one inverted solid accent appears per screen. Use soft tint backgrounds (`brand/8`, `brand/12`) elsewhere.
- Avoid large gradients and neon glows. Empty states allow subtle ambient radial glows (4–8%) to create depth without obscuring content.
- Code blocks use `--code` (`surface-secondary`), and inline code uses `surface-tertiary`.
- Colors convey semantic meaning only: warning, destructive, diff additions, and diff deletions. All other elements remain black, white, and grey.

## Typography

- Body / UI: **Geist Variable**
- Monospace / Metadata: **Geist Mono Variable**

Sizes prioritize density and information display:

| Usage                     | Size                                         | Description                         |
| ------------------------- | -------------------------------------------- | ----------------------------------- |
| Conversation text         | 13.5px / 1.75                                | Optimized for long reading sessions |
| UI labels                 | 12–13px                                      | Compact controls                    |
| Metadata, IDs, timestamps | 9.5–11px mono                                | Instrument-style readouts           |
| Section headers           | 10px mono uppercase + `0.1em` letter spacing | E.g., `GENERAL`, `TASKS`            |
| Empty state titles        | 22px / `-0.02em`                             | Prominent empty state heading       |

The tokens `--text-xs` and `--text-sm` override to font-weight 500 in Tailwind to keep small typography legible.

## Geometry and Elevation

- Corner radii use `--radius: 0.5rem` (8px). Navigation items and chips use 8px, cards use 12px, dialogs use 20px, and inputs use 8px.
- Shell surfaces remain flat. Dividers use 1px borders and surface contrast rather than elevation shadows.
- Subtle shadows are restricted to three items: overlays (dialogs, popovers, command palettes), brand marks, and primary buttons. Card hover uses `0 6px 20px -14px` elevation with a 1px upward shift. Shadows remain achromatic.
- Separators use 1px `border-default`. Do not use layout gaps to simulate lines.

## Components

| Component       | Specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar         | Brand mark with soft glow, New Conversation button (`⌘N`), navigation (Chat / Goals / Skills / Inbox), collapsible projects, and footer status with Settings gear (badge shows open improvement count). Hovering project headers reveals the Manager button (`UserGear`). Manager chats pin to the top of each project list. The first 5 conversations show by default; extras collapse into "Show more". Row hover reveals Archive / Restore. Selection uses a sliding pill with `layoutId` and inverted icons. The sidebar has a 2px ink indicator. Search routes through `⌘K`. Status dots use foreground colors rather than green. |
| Command Palette | Opens via `⌘K`. Searches conversations, switches scopes, navigates views, and refreshes models. Groups use icons and mono shortcut badges. Active rows show a 2px left accent bar.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Chat            | Assistant messages omit speech bubbles, displaying a 20px brand mark and `TIAN` mono label with hover copy buttons. User messages align right using `surface-secondary` with 12px rounded corners.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tool Call Chips | Displays icon, name, and status (spinning progress, solid check, or warning icon). Expands to inspect arguments and results. More than two calls collapse into summary rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Markdown        | Unified component (`Markdown.tsx`). Chat and Inbox text stream via Streamdown. Supports active streaming animations and unfinished syntax. Icons override to Phosphor. Mermaid blocks render via Pele.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Input Bar       | Two-row structure: textarea and action row. Focus shifts upward 1px with brand aura and displays shortcuts (`↵ send · ⇧↵ new line`). Send buttons use monochrome gradients; stop buttons use breathing rings.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Empty States    | Brand mark / orbital light ring, headline, explanation, and actionable suggestions (Plan my day / Review goals / Workspace check). Welcome view includes New Conversation and Browse (`⌘K`).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Context Pane    | Two-tab strip (Tasks / Runs; Memory panel implementation remains intact, but its tab is hidden). Sliding pill uses shared `layoutId` with filled icons when active. Panel switches cross-fade. Run list to detail transitions slide horizontally.                                                                                                                                                                                                                                                                                                                                                                                     |
| Settings        | Full-page overlay opened by gear icon or `⌘,`. Left anchor navigation; right panels for Model, Usage, Log, and Service. Closing returns to the originating view.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Diff Viewer     | Uses `@pierre/diffs` with unified mode, bar indicators, and `line-info-basic` folding. Themes synchronize with system mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Service Status  | Sidebar footer status: breathing foreground dot with mono label. Connection states transition to warning or destructive pulses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Motion

Animations use `motion` with two primary curves:

```ts
const EASE = [0.22, 1, 0.36, 1]; // Quick deceleration without bounce
const SPRING = { type: 'spring', stiffness: 500, damping: 38 }; // For shared layout animations only
```

| Action                    | Transition                             | Duration / Curve        |
| ------------------------- | -------------------------------------- | ----------------------- |
| Message appearance        | `opacity 0→1` + `y 8→0` + `blur 2→0`   | 300ms EASE              |
| Tool chip expansion       | Height and opacity                     | 220ms EASE              |
| View transition           | Cross-fade + `y ±6`                    | 180ms EASE              |
| Navigation toggle         | Translation + opacity                  | 240ms EASE              |
| Context pane toggle       | Translation + opacity                  | 240ms EASE              |
| Selection pill            | `layoutId` shared layout               | spring 500/38           |
| Task completion / reorder | `layout` + height fade                 | 180ms EASE              |
| Counter badge             | Scale `0.6→1`                          | spring 520/24           |
| Input focus               | Float 1px + brand ring + hint expand   | 200–300ms EASE          |
| Send / Stop switch        | `AnimatePresence popLayout` scale fade | 160ms EASE              |
| Command palette           | Dialog scale `98→100` + fade           | 200ms                   |
| Empty state orb           | Slow float + double pulse ring         | 7s / 2.8s loop          |
| Heatmap cell entrance     | Cascading scale `0.6→1` + fade         | 400ms (max 260ms delay) |
| Streaming text            | Streamdown word-by-word fade           | Controlled by library   |

**All animations honor `prefers-reduced-motion`**:

- React components use `useReducedMotion()`. When active, `initial={false}` and layout animation durations set to zero.
- CSS disables pulse, ping, float, shimmer, typing, and cell-in animations under `@media (prefers-reduced-motion: reduce)`. Spinners slow to 2.4s to indicate active work without rapid motion.
- Disallowed: bouncing springs, entrances over 400ms, large displacements, parallax, and continuous decorative rotation.

## Layout

```
┌────────────┬─┬───────────────────────────┬─┬──────────────────┐
│ Nav 264px  │▏│ Main View (Adaptive)      │▏│ Context 360px    │
│            │ │                           │ │                  │
│ Brand      │ │ Chat / Goals / Skills /   │ │ Header: Context  │
│ New chat   │ │ Inbox / Settings          │ │ Tabs             │
│ Chat       │ │                           │ │ Panel Content    │
│ Goals      │ │ Conversations / Goals /   │ │                  │
│ Skills     │ │ Skills / Inbox / Settings │ │                  │
│ Inbox      │ │                           │ │                  │
│ ─────────  │ │                           │ │                  │
│ PROJECTS   │ │                           │ │                  │
│ Scope list │ │                           │ │                  │
│ Chat list  │ │                           │ │                  │
│ (Fold > 5) │ │                           │ │                  │
│ ─────────  │ │                           │ │                  │
│ Service  ⚙ │ │                           │ │                  │
└────────────┴─┴───────────────────────────┴─┴──────────────────┘
```

- Three panes adjust via drag handles. Dividers are 2px wide. Hover and focus reveal inverted colors with centered grips, extending hit targets by 6px. Keyboard arrows (← and →) adjust width.
- Widths persist in `localStorage` (`tian.navWidth`, `tian.contextWidth`). Dragging sets transitions to zero, restoring them on release.
- Both sidebars collapse from title bar buttons. Collapsing uses transforms and fixed column widths to prevent text reflow. Sidebar state persists in `tian.sidebarOpen`.
- Windows use `titleBarStyle: hiddenInset`. Traffic lights sit inside a 44px drag area. Collapsed sidebars add `pl-20` padding to protect traffic light controls. Headers carry `-webkit-app-region: drag`, and interactive controls set `no-drag`.
- Keyboard shortcuts: `⌘K` command palette, `⌘N` new chat, `⌘B` toggle context pane, `⌃⌘S` toggle sidebar, `⌘,` toggle settings, `⌘1/2/3/4` switch primary views.

## Anti-Patterns (Do Not Do)

- Do not apply black and white gradients across panels, cards, or large buttons. Gradients belong on small badges, send buttons, and progress bars only.
- Do not add colored backgrounds or avatars to message bubbles. Brand marks act as identity anchors, not profile pictures. Avoid decorative hues outside warnings, destructive states, and diffs.
- Do not use heavy shadows (`shadow-xl`) or wide frosted glass to establish elevation. Subtle shadows are reserved for floating overlays and brand marks.
- Do not render diff views in modal dialogs; place them in the right context pane.
- Do not introduce second icon sets or raw inline SVG icons.
- Do not use entrance animations exceeding 400ms, and never let motion block user input.

## References

- Coder Theme Source: `coder/coder` repository at `site/src/theme/` (CSS variables in `palette.ts`, `roles.ts`, and `index.css`)
- [Phosphor Icons](https://phosphoricons.com/) — Unified icon system
- [Streamdown](https://streamdown.ai) — Streaming markdown renderer
- [Motion](https://motion.dev) — Animation engine
- Beautiful UI (<https://www.beautifului.dev/>) — AI primitives (tool chips, task rows, thinking trace)
- Codex / Cursor — Three-pane desktop layout
