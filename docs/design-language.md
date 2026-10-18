# 视觉语言：Coder 的 token 模型 + Codex 的布局

界面配色与组件形态对齐 [Coder](https://github.com/coder/coder) 的公开主题，布局对齐 Codex / Cursor 的三栏工作台。

## 为什么是 Coder

Coder 是开源的企业级开发工具，主题 token 直接躺在仓库里（`site/src/theme/`），可以精确抄而不是凭印象调。它的气质正好适合这个项目：**面向开发者的暗色、扁平、几乎无阴影、单一强调色**。我们不需要营销页那种渐变和光晕，需要的是长时间盯着不累、信息密度高的工具界面。

## 颜色

### 三层 token

Coder 把颜色拆成三个语义层，而不是一锅 shadcn 变量：

| 层      | 变量                                                                           | 用途       |
| ------- | ------------------------------------------------------------------------------ | ---------- |
| Content | `--content-primary/secondary/disabled/invert/link/success/warning/destructive` | 文字与图标 |
| Surface | `--surface-primary/secondary/tertiary/quaternary/control/invert-primary/...`   | 背景与填充 |
| Border  | `--border-default/secondary/control/destructive/success/warning/sky`           | 描边       |

关键实现细节：这些变量存的是**裸 HSL 通道**（`240 4% 16%`），在 `@theme inline` 里才拼成 `hsl(var(--border-default))`。这样任何 surface 都能直接加 alpha（`bg-surface-secondary/50`），不必为每个透明度再造一个 token。

shadcn/coss 需要的 `--background` / `--foreground` / `--muted` / `--primary` 等**只作为别名**指向上面三层，所以 coss 组件开箱即用，同时新代码可以直接用语义层。

### 具体取值

暗色（默认跟随系统，`prefers-color-scheme`）：

- 背景 `surface-primary` = `hsl(240 10% 4%)` — 近黑但不是纯黑，zinc-950 系
- 面板 `surface-secondary` = `hsl(240 6% 10%)`
- 分隔 `border-default` = `hsl(240 4% 16%)` — 1px，无阴影
- 主文字 `content-primary` = 白，次文字 `content-secondary` = `hsl(240 5% 65%)`
- 强调 `content-link` = `hsl(213 94% 68%)` — 唯一的高饱和色，只用于链接、focus ring、运行中状态
- 状态色：success `142 76% 42%`、warning `31 97% 72%`、destructive `0 91% 71%`

亮色是同一套结构的镜像：`surface-primary` 纯白，`surface-secondary` = zinc-100，文字 zinc-950，`content-link` 用更深的 `221 83% 53%` 保证对比度。

### 用色纪律

- 一屏最多一个强调色实例。状态点、badge 用低饱和底色（`surface-green` 之类）而不是实心亮色。
- 不用渐变、不用 glow、不用多重 box-shadow。层级靠**表面明度差 + 1px 描边**表达。
- 代码块背景用 `--code`（= `surface-secondary`），行内 code 用 `surface-tertiary`。

## 字体

- 正文/UI：**Geist Variable**（Coder 也用 Geist）
- 等宽/元数据：**Geist Mono Variable**

字号刻意偏小、密度偏高：

| 用途             | 字号                                | 说明                     |
| ---------------- | ----------------------------------- | ------------------------ |
| 对话正文         | 13.5px / 1.7                        | 长文可读性优先           |
| UI 标签          | 12–13px                             |                          |
| 元数据、ID、时间 | 10–11px mono                        | 统一用等宽，形成"仪表"感 |
| 分组标题         | 10px mono uppercase + `0.09em` 字距 | 如 `GENERAL`、`TASKS`    |

`--text-xs` / `--text-sm` 在 Tailwind 主题里被覆写成 500 字重，因为 Coder 的密集 UI 默认就是 medium。

## 形状与光影

- 圆角 `--radius: 0.5rem`（8px），小控件 6px，卡片 8px。比 shadcn 默认更方。
- **没有阴影**。全局在 `@layer base` 里把 button / input / composer / select / combobox 的 `box-shadow` 与伪元素高光全部 `none !important`，这是刻意覆盖 coss 的质感。
- 弹层（dialog / popover / drawer）只保留一层极轻的 `shadow-lg/5`，因为浮起来必须有边界暗示。
- 分隔一律 1px `border-default`，不用 `gap` 造假的线。

## 组件形态

| 组件     | 做法                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 侧栏项   | 8px 圆角，hover 用 `surface-tertiary`，选中用 `surface-tertiary` + 主文字色，不加左侧色条                                                  |
| 工具调用 | **chip**：小圆角 + 1px 边框 + `surface-secondary/60`，左侧状态点/勾/警告图标，可展开看 args 和 output；超过 2 个收成 "N tool calls" 汇总行 |
| Markdown | `streamdown`（Vercel 的流式 Markdown 库），`animated` + `isAnimating` 跟随流式状态，未闭合语法也能正确渲染                                 |
| 用户消息 | 右对齐气泡，`surface-secondary` + 边框，不用主题色填充                                                                                     |
| 助手消息 | **无气泡**，正文直接铺在背景上，最大宽度 52rem                                                                                             |
| 状态指示 | 小圆点 + mono 小字（`working…` / `thinking…` / `running`），不用 spinner 抢视线                                                            |
| 空状态   | 居中图标 + 一句话 + 可选按钮，垂直居中于可视区                                                                                             |
| 右栏     | 顶部四段 tab（Tasks / Runs / Memory / Inbox），每个 tab 带未完成计数；一次只渲染一个面板                                                   |
| Diff     | `@pierre/diffs`，unified + bars 指示器 + `line-info-basic` 折叠分隔，主题跟随系统明暗                                                      |

## 动效

统一用 `motion`（Framer Motion 的继任者），一条缓动曲线贯穿全局：

```ts
const EASE = [0.22, 1, 0.36, 1]; // 快速收尾，不回弹
const DURATION = 0.22;
```

| 位置                              | 动作                              | 时长                       |
| --------------------------------- | --------------------------------- | -------------------------- |
| 消息入场                          | `opacity 0→1` + `y 6→0`           | 220ms                      |
| 工具 chip 展开                    | 高度 + 透明度                     | 220ms                      |
| 主视图切换（Chat/Schedule/Inbox） | 交叉淡入 + `y ±4`                 | 160ms                      |
| 右栏开合                          | 宽度 + 透明度                     | 200ms                      |
| 导航栏宽度                        | 跟随拖拽，无过渡                  | 拖拽时 0，程序设置时 180ms |
| 任务勾选                          | `layout` 重排 + 淡出              | 180ms                      |
| 计数徽标                          | 缩放弹出 `0.7→1`                  | 160ms                      |
| 流式文字                          | Streamdown 的 `animated` 逐词淡入 | 由库控制                   |

**所有动效都尊重 `prefers-reduced-motion`**：`useReducedMotion()` 为真时，动画退化为瞬变（`initial={false}`，宽度/高度直接到位）。这是硬要求，不是可选优化。

不用：弹跳曲线、超过 300ms 的过渡、大面积位移、视差。

## 布局

```
┌────────────┬─┬───────────────────────────┬─┬──────────────────┐
│ 导航 264px │▏│ 主视图（自适应）           │▏│ 上下文 360px     │
│            │ │                           │ │                  │
│ Chat       │ │ Chat / Schedule / Inbox   │ │ header: Context  │
│ Schedule   │ │                           │ │ tabs             │
│ Inbox      │ │                           │ │ 面板内容         │
│ ─────────  │ │                           │ │                  │
│ PROJECTS   │ │                           │ │                  │
│ scope 分组 │ │                           │ │                  │
│ 会话列表   │ │                           │ │                  │
└────────────┴─┴───────────────────────────┴─┴──────────────────┘
```

左栏分两段：**固定目的地**（Chat / Schedule / Inbox，带未完成计数）在上，**projects + 会话列表**在下。Schedule 和 Inbox 是主视图，不是右栏 tab——它们是"要去的地方"，不是"当前对象的上下文"。

- 两侧分隔条 2px，hover/focus 变 `ring` 色，命中区向外扩 6px；支持键盘 ←→。
- 宽度持久化到 `localStorage`（`tian.navWidth` / `tian.contextWidth`）。
- 右栏可整体收起，收起后留 44px 竖条 + 一个 `PanelRight` 按钮。
- 窗口 `titleBarStyle: hiddenInset`，红绿灯在左栏顶部 36px 的 drag 区里；每个 pane 的 header 都是 `-webkit-app-region: drag`，交互控件单独标 `no-drag`。

## 反例（不要这么做）

- 不要在右栏堆四块内容再套 Tabs 之外的手风琴——信息层级会打架。
- 不要给消息气泡加彩色背景或头像。
- 不要用 `shadow-xl` / 模糊背景 / 毛玻璃表达层级。
- 不要把 diff 放进弹窗；它属于右栏。

## 参考

- Coder 主题源码：`coder/coder` 仓库 `site/src/theme/`（`palette.ts`、`roles.ts`、`index.css` 里的 CSS 变量）
- Beautiful UI（<https://www.beautifului.dev/>）的 AI 原语：tool chips、task rows、thinking trace
- [Streamdown](https://streamdown.ai) — Vercel 的流式 Markdown 渲染
- [Motion](https://motion.dev) — 动画库
- Codex / Cursor 的三栏工作台布局
