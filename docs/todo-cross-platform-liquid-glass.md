# Cross-Platform Support for Blurry / Liquid Glass (TODO & Architecture Roadmap)

This document tracks the implementation plan and technical roadmap for extending Tian Agent's **Liquid Glass / Blurry Glass** surface treatment beyond macOS to Windows and Linux.

---

## 1. Current State (macOS Native Implementation)

On macOS, Liquid Glass is implemented via AppKit's native compositor:

- **Window Level**: Electron `BrowserWindow` with `vibrancy: 'under-window'`, `visualEffectState: 'active'`, and `backgroundColor: '#00000000'`.
- **Renderer Level**:
  - **Left Sidebar**: Translucent backing (`bg-white/35 dark:bg-black/25 backdrop-blur-2xl`) directly revealing the vibrant system wallpaper with specular edge borders (`border-r border-border/40`).
  - **Top Header (`PaneHeader`)**: Glass strip (`bg-surface-primary/65 dark:bg-surface-primary/40 backdrop-blur-xl`) with physical specular rim highlight (`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]`) and bottom seam.
  - **Right Sidebar (`ContextPane`)**: Frosted crystal drawer (`bg-surface-primary/55 dark:bg-surface-primary/30 backdrop-blur-2xl`) separated by a hairline divider.
  - **Text & Accessibility (iOS 27 Standards)**: Foreground content, text, and icons stay on an unblurred top layer (`z-index: 10`) with high-contrast color tokens to eliminate readability issues on busy wallpapers.

---

## 2. Platform Expansion Plan

### Phase 1: Windows 11 & Windows 10

Unlike macOS, Windows does not have a single unified `vibrancy` property in Electron's public API that maps to all OS versions.

#### Windows 11 (Build 22000+)

- **Technology**: Desktop Window Manager (DWM) **Mica** (`DWMWA_SYSTEMBACKDROP_TYPE = 2`) or **Mica Alt / Tabbed** (`DWMWA_SYSTEMBACKDROP_TYPE = 4`).
- **Implementation Options**:
  1. Electron native DWM hook: Utilize Windows DWM window attributes via Win32 FFI or Electron's experimental Windows backdrop properties.
  2. High-performance fallback: `backgroundColor: '#00000000'` + DirectComposition blur.
- **Characteristics**:
  - Sampled once from the desktop wallpaper (very low GPU/battery impact).
  - Automatically follows light/dark theme changes.

#### Windows 10

- **Technology**: **Acrylic Blur Behind** (`SetWindowCompositionAttribute` with `ACCENT_ENABLE_BLURBEHIND`).
- **Challenges**:
  - Known window drag lag on low-power Intel iGPUs when resizing transparent windows.
  - Windows "Battery Saver" mode automatically disables transparency; the app must detect this via `systemPreferences` and fall back to solid surface tokens.

---

### Phase 2: Linux (X11 & Wayland)

Linux window compositing depends heavily on the running desktop environment (GNOME, KDE Plasma, wlroots, Sway, Hyprland).

#### X11

- **Window Transparency**: 32-bit ARGB visual (`transparent: true` in Electron).
- **Blur Compositor**:
  - KDE KWin: Native window background blur via `_KDE_NET_WM_BLUR_BEHIND_REGION` X11 property.
  - Picom (standalone compositor): Dual-kawase blur filter configured via `picom.conf` matching window class `tian-agent`.

#### Wayland

- **Challenge**: Wayland protocols isolate surfaces; clients cannot query what is behind them.
- **Solution**: Rely on compositor-side protocols (such as `ext-foreign-toplevel-list` or KDE Wayland blur protocols) where supported, or fall back to high-fidelity In-App DOM glass.

---

### Phase 3: Universal Software Fallback (In-App Glassmorphism)

For environments where OS-level window transparency is disabled, unsupported, or undesirable:

1. **CSS + SVG Lens Displacement**:
   - Use CSS `backdrop-filter: blur(...)` combined with SVG `<feDisplacementMap>` to simulate lens refraction between internal DOM layers (e.g., content scrolling behind the top titlebar or beneath the floating context pane).
2. **Mesh Gradient Underlay**:
   - Render a subtle ambient gradient background behind the floating card so glass layers still have visual depth to blur and refract even on a solid desktop.

---

## 3. Implementation Checklist / TODO

- [ ] **Platform Detection & Abstraction**:
  - [ ] Add a `getBackdropCapabilities()` utility in `src/main.ts` or `src/desktop/` to inspect OS version and battery state.
  - [ ] Expose the resolved backdrop mode to the renderer via IPC (`tian:window-capabilities`).
- [ ] **Windows Support**:
  - [ ] Investigate lightweight Win32 N-API module (or FFI) for `DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ...)`.
  - [ ] Test titlebar and window control rendering under Windows 11 rounded corners.
  - [ ] Add listener for `systemPreferences.on('accent-color-changed')` and battery-saver events.
- [ ] **Linux Support**:
  - [ ] Verify 32-bit ARGB visual on Ubuntu/Fedora (KDE and GNOME).
  - [ ] Implement `_KDE_NET_WM_BLUR_BEHIND_REGION` atom support on X11 if running on KDE.
  - [ ] Provide immediate opaque fallback if no compositor is running.
- [ ] **Accessibility & Power**:
  - [ ] Respect `prefers-reduced-transparency` media query (CSS `@media (prefers-reduced-transparency: reduce)`).
  - [ ] Automatically switch to opaque surfaces when running in low-power / battery-saver mode.
  - [ ] Provide a manual "Glass Intensity" setting slider under Settings → Appearance (matching iOS 27 design pattern).
