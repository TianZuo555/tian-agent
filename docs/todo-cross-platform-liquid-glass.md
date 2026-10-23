# Cross-Platform Liquid Glass Support (TODO & Architecture Roadmap)

**English** | [简体中文](zh/todo-cross-platform-liquid-glass.md)

This document tracks implementation plans and architectural steps to expand Tian Agent's **Liquid Glass** surface styling from macOS to Windows and Linux.

---

## 1. Current State (Native macOS Implementation)

On macOS, Liquid Glass utilizes AppKit's native compositor:

- **Window Configuration**: Electron `BrowserWindow` configures `vibrancy: 'under-window'`, `visualEffectState: 'active'`, and `backgroundColor: '#00000000'`.
- **Theme Synchronization**: The renderer's theme choice (`tian.theme`: system / light / dark) writes to `nativeTheme.themeSource` via `tian:theme` IPC. Vibrancy materials and window backplates match application themes rather than system appearances alone.
- **Renderer Surfaces**:
  - **Left Sidebar**: Translucent backing (`bg-white/20 dark:bg-white/[0.035] backdrop-blur-2xl`) revealing wallpaper vibrancy with inset highlights (`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]`).
  - **Top Titlebar (`PaneHeader`)**: Glass strip (`bg-background/80 dark:bg-background/60 backdrop-blur-xl`) with physical highlight borders (`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]`) and hairline dividers.
  - **Right Sidebar (`ContextPane`)**: Frosted crystal drawer (`bg-surface-primary/60 dark:bg-surface-primary/30 backdrop-blur-2xl`) separated by hairline borders.
  - **Typography and Accessibility**: Foreground text, content, and icons sit on unblurred upper layers (`z-index: 10`) using high-contrast tokens to ensure legibility across varied wallpapers.

---

## 2. Platform Expansion Plan

### Phase 1: Windows 11 and Windows 10

Unlike macOS, Windows lacks a unified vibrancy property in standard Electron APIs across all OS releases.

#### Windows 11 (Build 22000+)

- **Technology**: DWM **Mica** (`DWMWA_SYSTEMBACKDROP_TYPE = 2`) or **Mica Alt / Tabbed** (`DWMWA_SYSTEMBACKDROP_TYPE = 4`).
- **Implementation**:
  1. Electron native DWM hooks: Configure DWM window attributes via Win32 FFI or Electron experimental backdrop properties.
  2. Fallback: `backgroundColor: '#00000000'` with DirectComposition blur.
- **Characteristics**:
  - Samples desktop wallpapers once, ensuring low GPU and power overhead.
  - Synchronizes with dark/light themes automatically through `nativeTheme.themeSource`.

#### Windows 10

- **Technology**: **Acrylic Blur Behind** (`SetWindowCompositionAttribute`, `ACCENT_ENABLE_BLURBEHIND`).
- **Challenges**:
  - Performance drops on low-power integrated GPUs during window drag operations.
  - Windows Battery Saver disables transparency automatically; detect this state via `systemPreferences` and fall back to opaque surface tokens.

---

### Phase 2: Linux (X11 and Wayland)

Linux window composition depends on active desktop environments (GNOME, KDE Plasma, wlroots, Sway, Hyprland).

#### X11

- **Window Transparency**: 32-bit ARGB visual (`transparent: true` in Electron).
- **Blur Compositor**:
  - KDE KWin: Native background blur via `_KDE_NET_WM_BLUR_BEHIND_REGION` X11 atom.
  - Picom: Dual-kawase blur configured for window class `tian-agent` inside `picom.conf`.

#### Wayland

- **Challenges**: Wayland isolates surfaces; clients cannot query content behind their own windows.
- **Approach**: Use compositor protocols on supported environments (such as `ext-foreign-toplevel-list` or KDE Wayland blur protocols), or fall back to application-level DOM glass.

---

### Phase 3: Software Fallback (In-App Glassmorphism)

When system-level window transparency is disabled, unsupported, or degraded:

1. **CSS + SVG Lens Displacement**:
   - Combine CSS `backdrop-filter: blur(...)` with SVG `<feDisplacementMap>` to simulate lens refraction between internal DOM layers.
2. **Mesh Gradient Underlay**:
   - Render a subtle ambient gradient below floating cards to maintain visual depth on solid desktop backgrounds.

---

## 3. Implementation Checklist / TODO

- [ ] **Platform Detection & Abstraction**:
  - [ ] Add `getBackdropCapabilities()` in `src/main.ts` or `src/desktop/` to inspect OS versions and battery status.
  - [ ] Expose resolved backdrop capabilities to the renderer via IPC (`tian:window-capabilities`).
- [x] **Theme Alignment**:
  - [x] macOS: Sync renderer theme to `nativeTheme.themeSource` via `tian:theme`.
  - [ ] Windows / Linux: Connect backdrop renderers to the existing sync pipeline.
- [ ] **Windows Support**:
  - [ ] Evaluate lightweight Win32 N-API bindings or FFI for `DwmSetWindowAttribute`.
  - [ ] Verify title bar and window control rendering under Windows 11 rounded corners.
  - [ ] Listen for `systemPreferences.on('accent-color-changed')` and battery-saver events.
- [ ] **Linux Support**:
  - [ ] Validate 32-bit ARGB visuals on Ubuntu and Fedora under KDE and GNOME.
  - [ ] Implement `_KDE_NET_WM_BLUR_BEHIND_REGION` atom for KDE X11 sessions.
  - [ ] Fall back to opaque surfaces when no compositor is running.
- [ ] **Accessibility & Power**:
  - [ ] Respect `prefers-reduced-transparency` media queries (`@media (prefers-reduced-transparency: reduce)`).
  - [ ] Switch to opaque surfaces automatically during battery saver or low-power modes.
  - [ ] Provide a manual "Glass Intensity" slider in Settings → Appearance.
