# Tian Sky iOS frontend

The iOS entry is [`IOS.tsx`](IOS.tsx), built with NSH **0.4.0 (e626a8d)**.
It follows the **light and shadow** reference in
[`docs/design/client-mockup.html`](../../docs/design/client-mockup.html), with
the latest SVG sun and planet characters. It uses native views, native
navigation and modal sheets, native inputs, native photo selection, and
`DiffView`. No WebView is used.

## Run from the repository root

```sh
mise run ios:check
mise run ios:test
mise run ios:dev
mise run ios:package
```

Install NSH 0.4.0 first. `ios:dev` needs Xcode and an installed iOS simulator
runtime. `ios:package` produces
`crates/tian-nsh/.nsh/ios/Tian.app`; it does not require a simulator to be
booted. A device build is available with:

```sh
nsh package crates/tian-nsh/IOS.tsx --target ios --out crates/tian-nsh/.nsh/device
```

A device installation additionally needs Apple signing and a provisioning
profile; no distribution identity is selected here.

## Screens and interactions

| Screen        | Behaviour                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home          | Chief greeting and ambient light, waiting decision, Manager list, conversation search, floating composer entry, image sharing entry                            |
| Conversations | Chief delegation, Atlas review and phase cards, Juno migration approval, Vega empty state; per-conversation drafts, messages, attachments, and model overrides |
| Composer      | Growing multiline input, explicit image attachment with the native picker, image removal, send gating while disconnected, preserved drafts during reconnect    |
| Inspector     | Native sheet with scope, tasks, and Run summary; opens full-screen changes                                                                                     |
| Changes       | Native unified `DiffView`, horizontally scrolling file selector, line-number notes sent to Atlas, confirmed Land / Ship / Discard decisions                    |
| Share         | Native sheet with image previews, Chief / Manager target and optional note; attaches to a draft before explicit Send                                           |
| Settings      | Agent, Personal and Operations groups; all twelve detail pages; appearance, capture, notification and model controls; English/Chinese locale                   |
| Appearance    | Night, day and system; glass intensity, ambient light, reduced motion, chat text size and code preferences                                                     |
| Connection    | Online, syncing, reconnecting and offline states can be inspected under Server and devices                                                                     |

Glass uses NSH's system `glassEffect` with backdrop blur. A glass intensity of
zero uses opaque surfaces. Chief ambient light remains separate from the SVG
identity. Cards have a rim highlight; floating controls have downward shadows.
State animation honours the system's reduced-motion preference and the app's
reduced-motion setting. Controls use NSH base primitives and have accessible
names. Native navigation handles swipe back and modal dismissal. Notices use
native accessibility announcements.

Device preferences persist with NSH `Storage` under `tian.ios.preferences`.
Drafts, messages, review decisions and approvals are local to the running
preview. Changing the conversation model affects only that conversation.

## Data boundary

This is the **complete frontend preview**, using sample data. Sending saves a
local message. Approval and review actions update sample state. No action
contacts Pi Server, invokes a model, changes a repository, or modifies a live
database. Operations and account pages show sample records.

Pi Server transport, authentication, cross-device synchronization and durable
server commands remain gated by `docs/spec/`. This frontend does not define
that protocol. PhotoKit's recent-screenshot query, a system Share Extension,
native push notifications and a Live Activity require host capabilities beyond
these TSX screens and are not included. The Share screen is the in-app
attachment flow. The design marks the lock-screen Live Activity as v2.

## Identity assets

`Avatar.tsx` displays the same SVG characters on iOS and macOS. The 100 assets
in `assets/avatars` are generated from the four characters and 25 states in
`docs/design/avatars-svg/avatars.js`. The generator resolves browser CSS into
SVG presentation attributes because NSH's resvg does not run CSS animations
or resolve browser custom properties. NSH animates the state wrapper; faces do
not rotate.

Regenerate after changes to the SVG study:

```sh
mise exec -- node crates/tian-nsh/scripts/build-avatars.mjs
mise exec -- pnpm exec oxfmt --write crates/tian-nsh/avatar-sources.ts
```

The generator needs Google Chrome at its normal macOS path; `TIAN_CHROME` can
select another Chromium executable. Generated assets are committed, so neither
Chrome nor a browser engine is needed to build or run the app.

## Checks

`IOS.test.tsx` covers conversation isolation, approval finality, file switching,
review notes and decisions, reconnect draft recovery, saved appearance and
locale, search, model scope, explicit image sending and share cancellation.
The desktop tests use their desktop viewport. `nsh check` checks both entries
through the local TypeScript project. React Doctor checks the React renderer;
NSH source is excluded because its compiler and signal runtime are not React.

Verified on the iPhone 18 Pro Max simulator with iOS 27.2: native text entry,
send and draft isolation; approval rejection; Home, Atlas, Changes, Share,
Settings, and day/night appearance. The two repeatable native interaction
checks are:

```sh
nsh test crates/tian-nsh/IOS.test.tsx --target ios --filter 'mobile navigation'
nsh test crates/tian-nsh/IOS.test.tsx --target ios --filter 'rejected approval'
```

Photo selection stubs and preference storage assertions run headlessly. Native
VoiceOver gestures, PhotoKit access, hardware-device input, and distribution
signing have not been checked.
