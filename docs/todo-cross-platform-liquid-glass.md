# 跨平台毛玻璃 / Liquid Glass 支持(TODO 与架构路线)

本文档跟踪把 Tian Agent 的 **Liquid Glass / 毛玻璃** 表面处理从 macOS 扩展到 Windows 和 Linux 的实施计划与技术路线。

---

## 1. 现状(macOS 原生实现)

macOS 上 Liquid Glass 由 AppKit 原生合成器提供:

- **窗口层**:Electron `BrowserWindow` 配置 `vibrancy: 'under-window'`、`visualEffectState: 'active'`、`backgroundColor: '#00000000'`。
- **主题同步**:渲染进程的主题选择(`tian.theme`,system / light / dark)经 `tian:theme` IPC 写入 `nativeTheme.themeSource`,使 vibrancy 材质与窗口背板跟随应用内主题而非只看系统外观 —— 半透明表面不会叠加在相反主题的底板上。
- **渲染层**:
  - **左侧边栏**:半透明底板(`bg-white/20 dark:bg-white/[0.035] backdrop-blur-2xl`),直接透出系统壁纸的 vibrant 色彩,带高光内阴影(`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]`)。
  - **顶部标题栏(`PaneHeader`)**:玻璃条(`bg-background/80 dark:bg-background/60 backdrop-blur-xl`),带物理高光描边(`shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]`)与底部发丝线。
  - **右侧边栏(`ContextPane`)**:磨砂水晶抽屉(`bg-surface-primary/60 dark:bg-surface-primary/30 backdrop-blur-2xl`),以发丝分割线分隔。
  - **文字与无障碍(iOS 27 标准)**:前景内容、文字、图标保持在未模糊的上层(`z-index: 10`),使用高对比度色板 token,保证在复杂壁纸上的可读性。

---

## 2. 平台扩展计划

### 阶段一:Windows 11 与 Windows 10

与 macOS 不同,Windows 在 Electron 公开 API 中没有覆盖所有系统版本的统一 `vibrancy` 属性。

#### Windows 11(Build 22000+)

- **技术**:DWM **Mica**(`DWMWA_SYSTEMBACKDROP_TYPE = 2`)或 **Mica Alt / Tabbed**(`DWMWA_SYSTEMBACKDROP_TYPE = 4`)。
- **实现方式**:
  1. Electron 原生 DWM 钩子:经 Win32 FFI 或 Electron 实验性 Windows backdrop 属性设置 DWM 窗口属性。
  2. 高性能兜底:`backgroundColor: '#00000000'` + DirectComposition 模糊。
- **特性**:
  - 只对桌面壁纸采样一次(GPU / 耗电极低)。
  - 自动跟随亮 / 暗主题切换;应用内主题仍需经 `nativeTheme.themeSource` 同步,与 macOS 同一路径。

#### Windows 10

- **技术**:**Acrylic Blur Behind**(`SetWindowCompositionAttribute`,`ACCENT_ENABLE_BLURBEHIND`)。
- **挑战**:
  - 低功耗 Intel 核显拖动透明窗口时有已知卡顿。
  - Windows「节电模式」自动关闭透明效果;需经 `systemPreferences` 探测并回退到不透明 surface token。

---

### 阶段二:Linux(X11 与 Wayland)

Linux 窗口合成取决于运行中的桌面环境(GNOME、KDE Plasma、wlroots、Sway、Hyprland)。

#### X11

- **窗口透明**:32 位 ARGB visual(Electron `transparent: true`)。
- **模糊合成器**:
  - KDE KWin:经 `_KDE_NET_WM_BLUR_BEHIND_REGION` X11 属性获得原生背景模糊。
  - Picom(独立合成器):在 `picom.conf` 中为窗口类 `tian-agent` 配置 dual-kawase 模糊。

#### Wayland

- **挑战**:Wayland 协议隔离 surface,客户端无法查询自己背后的内容。
- **方案**:在支持的合成器上依赖合成器侧协议(如 `ext-foreign-toplevel-list` 或 KDE Wayland 模糊协议),否则回退到高保真的应用内 DOM 玻璃。

---

### 阶段三:通用软件兜底(应用内 Glassmorphism)

当系统级窗口透明被关闭、不受支持或不理想时:

1. **CSS + SVG 透镜位移**:
   - 用 CSS `backdrop-filter: blur(...)` 配合 SVG `<feDisplacementMap>` 在内部 DOM 层之间模拟透镜折射(如内容在顶部标题栏下、或在浮动上下文面板下滚动时)。
2. **网格渐变底层**:
   - 在浮动卡片下方铺一层柔和的环境渐变背景,使玻璃层即使在纯色桌面上也有可模糊、可折射的纵深。

---

## 3. 实施清单 / TODO

- [ ] **平台探测与抽象**:
  - [ ] 在 `src/main.ts` 或 `src/desktop/` 增加 `getBackdropCapabilities()`,探测系统版本与节电状态。
  - [ ] 经 IPC(`tian:window-capabilities`)把解析出的 backdrop 模式暴露给渲染进程。
- [x] **主题对齐**:
  - [x] macOS:渲染进程主题经 `tian:theme` 同步到 `nativeTheme.themeSource`,vibrancy 材质跟随应用主题。
  - [ ] Windows / Linux:实现各自 backdrop 后同样接入该同步路径。
- [ ] **Windows 支持**:
  - [ ] 评估轻量 Win32 N-API 模块(或 FFI)调用 `DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ...)`。
  - [ ] 验证 Windows 11 圆角下标题栏与窗口控件的渲染。
  - [ ] 监听 `systemPreferences.on('accent-color-changed')` 与节电事件。
- [ ] **Linux 支持**:
  - [ ] 在 Ubuntu / Fedora(KDE 与 GNOME)验证 32 位 ARGB visual。
  - [ ] KDE 的 X11 会话下实现 `_KDE_NET_WM_BLUR_BEHIND_REGION` atom。
  - [ ] 无合成器运行时立即回退不透明表面。
- [ ] **无障碍与功耗**:
  - [ ] 尊重 `prefers-reduced-transparency` 媒体查询(`@media (prefers-reduced-transparency: reduce)`)。
  - [ ] 低功耗 / 节电模式下自动切换为不透明表面。
  - [ ] 在 设置 → 外观 中提供手动「玻璃强度」滑杆(对齐 iOS 27 设计规范)。
