# Animated sun and planet avatars

Open [index.html](index.html) directly or serve this folder over HTTP. This separate study contains four vector characters, 25 lifecycle states, live colour and accessory controls, a state gallery, and SVG downloads. Both HTML mockups use these SVG identities through `../avatar-identities.js`. The light version retains the Chief ambient light and floating glass shadows. The raster study remains available for reference.

- [chief-sun.svg](chief-sun.svg): detached sun rays; initial state `thinking`.
- [manager-atlas.svg](manager-atlas.svg): Earth with glasses; initial state `reading`.
- [manager-juno.svg](manager-juno.svg): Saturn; initial state `working`.
- [manager-vega.svg](manager-vega.svg): banded planet with a beret; initial state `sleeping`.
- [all-states.zip](all-states.zip): 100 standalone SVGs, one for every character/state combination.

These are SVG paths and CSS animations, with no raster images, external fonts, SVG scripts, filters, glow, or animation dependencies. Use a modern browser that supports CSS `color-mix()`. Static image viewers may show only a still frame. Each SVG has a transparent background and a `240 × 240` viewBox.

## Geometry and colour

The sun body has radius 64. Its rounded rays start at radius 84 with stroke width 11, leaving a **14.5-unit clear gap**. The sleep pose scales the rays to 96%, leaving more than 11 units. The rays rotate independently; the face never spins. The sun's overall breathing transform moves the body and rays together.

`--planet-color` is the identity colour. The body uses a very small tonal gradient (12% white at the light end). Continents, bands, rings, ray colour, and badge backgrounds derive from that one variable. The face and accessories use `--ink`; cheeks use `--cheek`; external state marks use `--signal`. `render()` and `update()` choose dark or light face ink using relative luminance contrast, so very dark planet colours keep visible eyes. Badge icons retain dark ink on their pale backgrounds. States do not replace the chosen identity colour. If you edit a standalone SVG's colour variable manually, adjust `--ink` too for extreme palettes; the preview does both automatically.

Accessories: `none`, `glasses`, `beret`, and `star`. Every accessory works with every character and state. Eyes and mouths remain visible under the glasses. The foreground Saturn ring stays below the mouth.

## State coverage

All four characters support all 25 states. Motion is shared where the meaning is shared, while state symbols distinguish the operation. Every state has a static expression or symbol when motion is reduced. State names describe presentation, not new backend enums.

| State         | Meaning                                 | Expression and motion                             |
| ------------- | --------------------------------------- | ------------------------------------------------- |
| `idle`        | Available, no active turn               | Gentle breathing and occasional blink             |
| `listening`   | Receiving user input                    | Lean in, slightly larger eyes                     |
| `queued`      | Accepted but not started                | Half-open eyes, still body, hourglass             |
| `thinking`    | Reasoning                               | Look up, gentle tilt, sequential thought dots     |
| `planning`    | Organising steps                        | Raised brows, sideways gaze, plan symbol          |
| `delegating`  | Handing work to another agent           | Turn between sides, branching arrow               |
| `reading`     | Reading context or files                | Eyes scan across and down, book symbol            |
| `editing`     | Modification phase                      | Small focused nods, pencil symbol                 |
| `working`     | Active work with no more specific phase | Subtle rhythmic movement; sun rays rotate         |
| `executing`   | Tool or command in progress             | Working pose with terminal symbol                 |
| `verifying`   | Testing or checking results             | Slow checking nod, check/list symbol              |
| `reviewing`   | Reviewing an artifact                   | Tilted slow scan, magnifying glass                |
| `streaming`   | Producing a response                    | Mouth opens and closes, speech bubble             |
| `collecting`  | Gathering output and artifacts          | Look down and gather, tray symbol                 |
| `waiting`     | Needs user input or approval            | Still tilted question pose                        |
| `blocked`     | Missing a prerequisite or permission    | Still, serious face and lock                      |
| `success`     | Completed                               | Closed happy eyes, one short hop, check mark      |
| `error`       | Failed                                  | Still concerned face and exclamation mark         |
| `retrying`    | Another attempt is starting             | Gentle recovery sway, retry arrow                 |
| `paused`      | Deliberately suspended                  | Half-closed eyes, still body, pause bars          |
| `cancelled`   | User or agent cancelled work            | Settled body, neutral mouth, cross                |
| `interrupted` | Attempt stopped unexpectedly            | Surprised eyes, break symbol                      |
| `sleeping`    | Explicit rest state                     | Closed eyes, slow breathing, sleep marks          |
| `connecting`  | Starting or restoring connection        | Attentive waiting pose, connection symbol         |
| `offline`     | Connection unavailable                  | Closed eyes, static faded body, disconnected mark |

## Connection to runtime state

The repository currently separates Task status, Run status, message status, and runtime connection status. Reference: `src/shared/types.ts`, `src/shared/messages.ts`, `src/worker/run-progress.ts`, and `docs/prd.md`. This prototype does not connect to live agent events.

| Existing signal                                           | Suggested display                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Task `pending`, Run `queued`, pending tool call           | `queued`                                                          |
| Task or Run `running`                                     | Specific observed phase; otherwise `working`                      |
| Run `collecting`                                          | `collecting`                                                      |
| Task `waiting_approval` or explicit input request         | `waiting`                                                         |
| Task `blocked`                                            | `blocked`                                                         |
| Task `paused`                                             | `paused`                                                          |
| Task `cancelled`                                          | `cancelled`                                                       |
| Run `interrupted`                                         | `interrupted`                                                     |
| Task `failed`, Run `failed`, tool error                   | `error`, unless an explicit retry is already active               |
| Task `completed`, Run `done`, successful completion event | `success`, then `idle` when the UI acknowledges completion        |
| Runtime `starting`                                        | `connecting`                                                      |
| Runtime `disconnected`                                    | `offline`; use `connecting` only while a reconnect is in progress |
| Runtime `failed`                                          | `error` with the connection error in accompanying text            |
| Runtime `ready`                                           | Current activity, or `idle`                                       |

Chief remains the coordinator. An editing/execution phase on a Manager avatar can describe its supervised Worker, with the Worker phase written in the presence line. Do not label Chief as editing code merely because a delegated Worker is editing. Thinking, planning, delegating, and retrying require an explicit event; elapsed time alone is not evidence. A quiet agent is not automatically asleep or offline.

When signals overlap, resolve connection health first, then explicit cancellation/interruption/pause/block/approval, then active retry or current phase, then completion/idle. Preserve the underlying task state separately so a reconnect does not overwrite it. Display a text presence label alongside the avatar; the face is not the only status indicator.

## Use and export

Load `avatars.js` as a regular script. It exposes `globalThis.TianAvatar` and works in a local HTML file without a build step.

```js
container.innerHTML = TianAvatar.render({
  kind: 'earth',
  accessory: 'glasses',
  color: '#76C4B1',
  state: 'thinking',
  label: 'Atlas is thinking',
});
const svg = container.querySelector('svg');
TianAvatar.update(svg, { state: 'sleeping' });
TianAvatar.update(svg, { color: '#C38FBC' });
TianAvatar.update(svg, { motion: 'reduced' });
```

`update()` changes the same SVG node, allowing eyes, mouths, and poses to transition. `render()` creates unique gradient/clip IDs, so differently coloured instances can coexist. To change the character or accessory, render a new instance. The preview exports the current state, colour, and accessory. A preview pause is not exported as a frozen animation; an explicit reduced-motion choice is preserved.

For inline SVGs, change the root `--planet-color` property. With an external `<img src="…svg">`, parent-page CSS cannot reach the SVG internals; export the desired palette or inline the SVG. The root `data-state` and `data-pose` are updated together by the helper. Prefer the helper or a generated state file over editing one attribute manually.

The preview has separate controls for pause and reduced motion. System `prefers-reduced-motion` always wins, including in standalone SVGs. State cycling starts only when requested and stops when the page is hidden, motion is paused, or reduced motion is enabled. No animation loop is driven by JavaScript; CSS animates transforms and opacity. Body shape distortion is limited to small scale changes.

Rebuild the four example files and ZIP after changing `avatars.js`:

```sh
mise exec -- node docs/design/avatars-svg/build-assets.mjs
```

The build uses Node and Python standard libraries, validates all exported SVGs as XML, and archives them with `zipfile`.
