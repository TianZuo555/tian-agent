# Client Platform Spec

**English** | 简体中文 (to follow)

Status: Draft v0.1 — 2026-11.

## 1. Targets and Order

One TSX app, six targets. The order below is the order of work, not priority of value.

| #   | Target  | NSH backend   | Why this position                                                            |
| --- | ------- | ------------- | ---------------------------------------------------------------------------- |
| 1   | macOS   | AppKit        | The server runs on this machine; shortest loop; native window material       |
| 2   | Web     | HTML          | Fastest way to expose protocol and IA gaps; no signing; shareable for review |
| 3   | iOS     | UIKit         | The main remote client; needs Xcode, so start early                          |
| 4   | Android | Android views | Same protocol as iOS; signing and store work is the bulk                     |
| 5   | Windows | Win32         | Second desktop; needs a Windows machine or VM for packaging tests            |
| 6   | Linux   | GTK 4         | Last; the server build for Linux also lands here                             |

Requirement: the TSX app contains **no platform branches**. Anything platform-specific goes through a module the Rust host implements, or is omitted on the targets that cannot do it (with a visible reason).

## 2. TSX and Rust Split

The TSX module runs in QuickJS under a capability sandbox. The Rust host crate is not sandboxed and can use the filesystem, sockets, keychain, and platform APIs.

| Concern                                                         | Where              | Notes                                                                                                                         |
| --------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Screens, layout, styles, state reducers, i18n                   | TSX                | Bundled with the app; hot-reload in development                                                                               |
| Protocol codec, transport (UDS + WSS), reconnect, resume, cache | Rust host          | Exposed to TSX as one typed module (see §3)                                                                                   |
| Device identity, keychain, tailnet discovery                    | Rust host          | `security-framework` on macOS, DPAPI/Credential Manager on Windows, Secret Service on Linux, Keychain/Keystore on iOS/Android |
| Notifications, tray, menus, dock, global shortcuts              | Rust host          | Per-platform; TSX calls one interface                                                                                         |
| File browsing and uploads                                       | Rust host + server | The server owns project files; remote browsing is a server command, and local attachments upload from the client              |
| Cache database                                                  | Rust host          | SQLite via `rusqlite`, read-only offline                                                                                      |
| Updates                                                         | Rust host          | NSH updater or platform installer                                                                                             |

Consequences:

- TSX does not use `fetch`, `WebSocket`, or `net` for the Pi API. Those capabilities stay unneeded for product traffic, which keeps the sandbox tight.
- A mixed project (`nsh init --template mixed`) is the starting point: TSX for views, one Rust crate for the host module.
- The Rust module declares its TypeScript face from the same definitions, so `.nsh/types` stays correct without hand-written declaration files.

## 3. Host Module Contract (Rust ↔ TSX)

Names are illustrative; the shape is the requirement.

```ts
// provided by the Rust host module
interface PiClient {
  configure(options: {
    server: string;
    deviceId: string | null;
  }): Promise<void>;
  connect(): Promise<Welcome>;
  call<K extends CommandName>(command: K, args: Args<K>): Promise<Result<K>>;
  subscribe(conversationId: string): Promise<void>;
  unsubscribe(conversationId: string): Promise<void>;
  onEvent(handler: (event: ServerEvent) => void): () => void;
  onStatus(handler: (status: ConnectionStatus) => void): () => void;
  cache(): CacheReader; // snapshots for offline start
  devices(): Promise<DeviceInfo[]>;
  revokeDevice(id: string): Promise<void>;
}
```

- Rust owns `hello`/`welcome`, version negotiation, resume cursor, frame limits, keepalive, reconnect, and the dedupe-safe retry of requests.
- Rust owns the outbound `requestId` generation and keeps it across retries, so a TSX re-render cannot create a duplicate intent. TSX passes an intent key (`submit:conv-1:2026-11-05T09:12:33`) and Rust derives the id.
- Events reach TSX as plain objects in the `AppEvents` shape (`src/shared/types.ts:399`), so the existing reducers port with minimal changes.
- The command surface is generated from `src/shared/contracts.ts` into Rust types (TypeScript types → JSON Schema → `serde` structs, or `ts-rs`) and checked in CI: a contract change that is not regenerated fails the build.

## 4. Onboarding and Discovery

1. **Server address.** The client ships with no hardcoded server. It resolves one in this order: saved address → `PI_SERVER` build-time default (development build only) → Tailscale MagicDNS candidate list (`tailscale status --json` on the desktop, the app's known hosts on mobile) → manual entry.
2. **Connect.** Desktop and mobile clients connect to `wss://<magicdns-name>:8787`. The server verifies the node with `WhoIs`.
3. **Pair.** The first handshake creates a device record on the server. The client shows the device name (`MacBook Air`, `iPhone`) and the server's name; the user confirms once. A second attempt from the same node reuses the record.
4. **Nothing to steal.** There is no pairing code in v1: the tailnet is the credential. A node with ACL access is trusted; revocation is per device and per tailnet node.
5. **Several servers.** Not supported in v1. The client stores one server; switching requires a reconnect flow and clears the cache.

Web target specifics: the web build is served by the server at the tailnet host and connects back to the same origin. It has no keychain; `deviceId` lives in origin-scoped storage. Because the origin is tailnet-only, this is acceptable in v1 and documented in the client.

## 5. Local Cache and Offline

- Rust keeps a SQLite cache per server: channel snapshots with revisions, conversation list, the last N pages of each open conversation, settings, and the resume cursor.
- Cold start shows cached content immediately, then reconciles with the server. The UI marks cached data only when it is disconnected (banner in [ui.md](ui.md#9-states)).
- Offline is read-only. The composer is disabled with a reason. No client-side write queue exists; a pending intent is a user-visible failed send with a retry that reuses the same `requestId`.
- Cache limits: 200 MiB per server, LRU by conversation; clearing the cache is a Settings action.
- Attachments and images are not cached in v1; they are fetched with `readAttachment` on open and show a placeholder when offline.

## 6. Platform Services Matrix

| Capability                    | macOS        | Windows      | Linux                  | iOS           | Android       | Web                       |
| ----------------------------- | ------------ | ------------ | ---------------------- | ------------- | ------------- | ------------------------- |
| Native notifications          | yes          | yes          | yes (libnotify)        | yes           | yes           | Notification API, limited |
| Push notifications            | —            | —            | —                      | open question | open question | —                         |
| Menu bar / tray               | yes          | yes          | yes                    | —             | —             | —                         |
| Global shortcut (⌘K / Ctrl+K) | yes          | yes          | yes (portal, may fail) | —             | —             | —                         |
| Launch at login               | yes          | yes          | yes                    | —             | —             | —                         |
| File dialogs (local)          | yes          | yes          | yes                    | yes           | yes           | file input                |
| Keychain / secure storage     | yes          | yes          | yes                    | yes           | yes           | origin storage            |
| Background execution          | yes (server) | yes (server) | yes (server)           | limited       | limited       | no                        |
| Deep links (`pi://`)          | v2           | v2           | v2                     | v2            | v2            | no                        |

## 7. Packaging, Signing, Distribution

| Target  | Package                            | Signing                                   |
| ------- | ---------------------------------- | ----------------------------------------- |
| macOS   | `.app` + DMG                       | Developer ID, notarized, hardened runtime |
| Windows | MSIX or NSIS installer             | Authenticode                              |
| Linux   | AppImage + `.deb`                  | optional GPG                              |
| iOS     | TestFlight, then App Store         | Apple Distribution + provisioning         |
| Android | AAB for Play, APK for sideload     | upload key                                |
| Web     | static bundle served by the server | TLS from Tailscale                        |

Store constraints matter for the product: Apple and Google require review and can reject chat apps with arbitrary code execution. The server does the execution; the client only displays it. That story must be written down before the first store submission, especially for Runs that change files on the server.

## 8. Updates

- Client and server version independently. The server advertises `minClientVersion`; older clients show the upgrade screen ([protocol.md](protocol.md#12-compatibility-policy)).
- Desktop: in-app update (NSH updater or Sparkle/WinSparkle as fallback), staged and verified, with rollback on failed launch.
- Mobile and web: store/refresh, no custom updater. The web build is always the server's version.
- The protocol's capability flags are the contract; an update must not require a synchronized release.

## 9. Testing

| Layer     | Test                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| Rust host | unit tests for codec, resume, dedupe, cache; a fake server for transport tests                                |
| TSX       | component tests over a fake `PiClient`; reducer tests ported from `src/renderer/state.ts`                     |
| Protocol  | contract test against a real service started with a throwaway data dir; golden `hello`/`welcome`/event frames |
| UI        | one smoke path per target: launch → list → open conversation → send → receive → reconnect                     |
| Visual    | screenshot baseline for chat, list, inspector on macOS; manual review elsewhere                               |

CI cannot build all six targets on every commit. Required per PR: typecheck, `nsh check`, Rust tests, protocol contract test. Target builds run nightly and before a release.

## 10. Open Questions

1. Push on iOS/Android: APNs/FCM through a small relay, or no push until the app is opened? The tailnet has no push service.
2. Discovery: MagicDNS name resolution needs `tailscaled` running on the device. On iOS the Tailscale app can be off; do we require it, or add a fallback that opens the Tailscale app?
3. Should the client talk to the server through the Tailscale userspace stack on mobile (battery, background), or rely on the system extension?
4. Web build hosting: served by the server (same origin, simplest) or a static host? Serving it from the server means the server needs a static file route and TLS.
5. Desktop auto-update on Windows and Linux: NSH updater parity, or platform installers only in v1?
