# 视觉语言：墨色表面 + 单色强调

界面骨架仍然是 Coder 的 token 模型 + Codex / Cursor 的三栏工作台，但在“安静的开发者工具”之上加了一层属于 Tian 的身份：**墨色表面、黑白灰的单色强调、Phosphor 图标、克制的动效**。所有装饰都必须服务于“正在发生什么”，而不是抢走注意力。

## 为什么是 Coder + Phosphor

Coder 是开源的企业级开发工具，主题 token 直接躺在仓库里（`site/src/theme/`），可以精确抄而不是凭印象调。它的气质适合长时间盯屏：**暗色、扁平、几乎无阴影、单色强调**。

图标统一用 [Phosphor](https://phosphoricons.com/)：同一套 256 网格、六种字重，线性、填充、双色都能无缝换挡。默认 `bold`（12–16px 密度下更清晰），选中态用 `fill`，空状态用 `duotone`。项目内不再出现第二套图标库；Streamdown 的代码块/表格控件也通过 `icons` 覆盖成 Phosphor。

## 颜色

### 三层 token

Coder 把颜色拆成三个语义层，而不是一锅 shadcn 变量：

| 层      | 变量                                                                           | 用途       |
| ------- | ------------------------------------------------------------------------------ | ---------- |
| Content | `--content-primary/secondary/disabled/invert/link/success/warning/destructive` | 文字与图标 |
| Surface | `--surface-primary/secondary/tertiary/quaternary/control/invert-primary/...`   | 背景与填充 |
| Border  | `--border-default/secondary/control/destructive/success/warning/sky`           | 描边       |

变量存**裸 HSL 通道**（`240 4% 16%`），在 `@theme inline` 里才拼成 `hsl(var(--border-default))`。这样任何 surface 都能直接加 alpha（`bg-surface-secondary/50`），不必为每个透明度再造一个 token。

shadcn/coss 需要的 `--background` / `--foreground` / `--muted` / `--primary` 等**只作为别名**指向上面三层，所以 coss 组件开箱即用，同时新代码可以直接用语义层。

### 单色强调

在语义色之外，只有一组**无彩色**的强调 token，用来回答“这是 Tian”：

- `--brand`：近黑墨色 `240 6% 10%`（亮色）/ 近白 `0 0% 98%`（暗色）
- `--brand-2`：中灰 `240 5% 42%` / `240 4% 72%`
- `--brand-contrast`：反相文字色，亮色 `0 0% 100%`、暗色 `240 10% 4%`
- `--brand-soft`：浅灰底，用于极淡的选中态
- `.bg-brand-gradient`：`brand → brand-2` 的 135° **黑白/灰白渐变**，只用于品牌标记、发送按钮、进度条等极少数锚点
- `.shadow-brand`：只给品牌标记和主 CTA 的深色柔和投影

链接、焦点环、选中导航、运行中状态都收拢到 `--brand`，所以整个界面只有一种“强调”语气：亮色下是墨黑，暗色下是纸白。状态色只保留语义最小集：warning `38 75% 66%`、destructive `0 60% 66%`（暗色）；success 本身退化为 monochrome（用勾/叉和文字表达），只有 diff 的增删行保留绿/红。

### 用色纪律

- 黑白渐变只出现在“品牌标记 / 发送 / 进度”这类极小面积上；正文、面板、导航背景保持无彩。
- 一屏最多一个实心反相实例；其余用 `brand/8`、`brand/12` 的浅底表达。
- 不用大面积渐变、不用霓虹 glow。空状态允许 `.ambient-glow` 的极淡黑白径向光（4–8%），制造深度但不照亮内容。
- 代码块背景用 `--code`（= `surface-secondary`），行内 code 用 `surface-tertiary`。
- 颜色只承担语义：warning / destructive / diff added / diff deleted。其余一切都是黑、白、灰。

## 字体

- 正文/UI：**Geist Variable**
- 等宽/元数据：**Geist Mono Variable**

字号刻意偏小、密度偏高：

| 用途             | 字号                               | 说明                   |
| ---------------- | ---------------------------------- | ---------------------- |
| 对话正文         | 13.5px / 1.75                      | 长文可读性优先         |
| UI 标签          | 12–13px                            |                        |
| 元数据、ID、时间 | 9.5–11px mono                      | 统一等宽，形成“仪表”感 |
| 分组标题         | 10px mono uppercase + `0.1em` 字距 | 如 `GENERAL`、`TASKS`  |
| 空状态标题       | 22px / `-0.02em`                   | 只在这里放大字号       |

`--text-xs` / `--text-sm` 在 Tailwind 主题里被覆写成 500 字重，因为密集 UI 默认就是 medium。

## 形状与光影

- 圆角 `--radius: 0.5rem`（8px）。导航项/工具 chip 8px，卡片 12px，对话框 20px，输入框 8px。
- **chrome 保持扁平**：导航、面板、列表用 1px 描边和 surface 明度差分层，不用阴影。
- 只有三类元素允许轻阴影：浮层（dialog / popover / command）、品牌标记、主 CTA。卡片 hover 用 `0 6px 20px -14px` 的极轻投影 + 上移 1px。阴影始终是无彩的。
- 分隔一律 1px `border-default`，不用 `gap` 造假的线。

## 组件形态

| 组件     | 做法                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏     | 顶部品牌标记（黑白渐变 + 柔光）、New conversation 主按钮（`⌘N`）、Chat/Goals/Skills/Inbox 导航、可折叠 Projects、会话搜索、底部服务状态与 Settings 齿轮。每个 scope 的会话只展开前 5 条，其余收进 `Show more`；选中的会话始终可见。选中项用共享 `layoutId` 的滑动 pill + 反相填充图标；会话行再加一条 2px 墨色/纸白左标。底部状态点用 foreground，不再使用绿色。 |
| 命令面板 | `⌘K` 打开，搜索会话、切换 scope、跳转页面（含 Settings）、刷新模型。分组用图标 + 右侧 mono 快捷键；高亮项左侧 2px 墨色/纸白标。                                                                                                                                                                                                                                  |
| 对话     | 助手消息无气泡，左上角 20px 品牌标记 + `TIAN` mono 标签；hover 出现复制按钮。用户消息右对齐、`surface-secondary`、圆角 12px。                                                                                                                                                                                                                                    |
| 工具调用 | **chip**：图标（按工具类型映射）+ 名称 + 状态（运行中转圈 / 成功实心勾 / 失败警告），可展开看 args 和 output；超过 2 个收成 “N tool calls” 汇总行。                                                                                                                                                                                                              |
| Markdown | `streamdown`，`animated` + `isAnimating` 跟随流式状态，未闭合语法也能正确渲染；控件图标覆盖为 Phosphor。                                                                                                                                                                                                                                                         |
| 输入框   | 双行结构：textarea + 发送/停止；聚焦时上浮 1px、反相光环、底部展开 `↵ send · ⇧↵ new line` 提示。发送按钮在可发送时用黑白渐变，停止按钮带呼吸环。                                                                                                                                                                                                                 |
| 空状态   | 品牌标记 / 轨道光球 + 一句标题 + 一句解释 + 可点击建议（Plan my day / Review goals / Workspace check）。欢迎页给 New conversation + Browse（⌘K）。                                                                                                                                                                                                               |
| 右栏     | 顶部三段 tab（Tasks / Runs / Memory），共享 `layoutId` 的滑动 pill，图标选中填充；面板切换 cross-fade；Run 列表 → 详情用横向滑动。                                                                                                                                                                                                                               |
| 设置页   | 侧栏底部齿轮或 `⌘,` 进入整页；左侧锚点导航，右侧依次 Model（模型与 Gateway）、Usage（热力图，可切 scope）、Log（改进日志与筛选）、Service（服务与升级）。                                                                                                                                                                                                        |
| Diff     | `@pierre/diffs`，unified + bars 指示器 + `line-info-basic` 折叠分隔，主题跟随系统明暗。                                                                                                                                                                                                                                                                          |
| 服务状态 | 侧栏底部：绿色呼吸点 + mono 状态；断开/连接中切到 warning 色。                                                                                                                                                                                                                                                                                                   |

## 动效

统一用 `motion`（Framer Motion 的继任者）。两条曲线：

```ts
const EASE = [0.22, 1, 0.36, 1]; // 快速收尾，不回弹
const SPRING = { type: 'spring', stiffness: 500, damping: 38 }; // 只在共享布局上用
```

| 位置                | 动作                                          | 时长 / 曲线            |
| ------------------- | --------------------------------------------- | ---------------------- |
| 消息入场            | `opacity 0→1` + `y 8→0` + `blur 2→0`          | 300ms EASE             |
| 工具 chip 展开      | 高度 + 透明度                                 | 220ms EASE             |
| 主视图切换          | 交叉淡入 + `y ±6`                             | 180ms EASE             |
| 右栏开合            | 宽度 + 透明度                                 | 240ms EASE             |
| 导航/会话选中 pill  | `layoutId` 共享布局                           | spring 500/38          |
| 任务勾选 / 列表重排 | `layout` + 高度淡出                           | 180ms EASE             |
| 计数徽标            | 缩放弹出 `0.6→1`                              | spring 520/24          |
| 输入框聚焦          | 上浮 1px + 品牌光环 + 提示行展开              | 200–300ms EASE         |
| 发送 / 停止图标切换 | `AnimatePresence popLayout` 缩放淡入淡出      | 160ms EASE             |
| 命令面板            | 由 Base UI dialog 负责（scale 98→100 + 淡入） | 200ms                  |
| 空状态品牌球        | 缓慢浮动 + 双层脉冲环                         | 7s / 2.8s loop         |
| 热力图格子          | 逐个 `scale 0.6→1` + 淡入                     | 400ms，最多 260ms 延迟 |
| 流式文字            | Streamdown 的 `animated` 逐词淡入             | 由库控制               |

**所有动效都尊重 `prefers-reduced-motion`**：

- React 侧统一 `useReducedMotion()`；为真时 `initial={false}`，共享布局时长 0。
- CSS 侧在 `@media (prefers-reduced-motion: reduce)` 里关掉 pulse、ping、float、shimmer、typing、cell-in；spinner 放慢到 2.4s，仍然表达“进行中”。

不用：弹跳曲线、超过 400ms 的入场、大面积位移、视差、连续旋转的装饰元素。

## 布局

```
┌────────────┬─┬───────────────────────────┬─┬──────────────────┐
│ 导航 264px │▏│ 主视图（自适应）          │▏│ 上下文 360px     │
│            │ │                           │ │                  │
│ 品牌       │ │ Chat / Goals / Skills /   │ │ header: Context  │
│ New chat   │ │ Inbox / Settings          │ │ tabs             │
│ Chat       │ │                           │ │ 面板内容         │
│ Goals      │ │ 对话 / 目标 / 技能 /      │ │                  │
│ Skills     │ │ 收件箱 / 设置             │ │                  │
│ Inbox      │ │                           │ │                  │
│ ─────────  │ │                           │ │                  │
│ PROJECTS   │ │                           │ │                  │
│ scope 分组 │ │                           │ │                  │
│ 会话列表   │ │                           │ │                  │
│ (5 条折叠) │ │                           │ │                  │
│ ─────────  │ │                           │ │                  │
│ 服务状态 ⚙ │ │                           │ │                  │
└────────────┴─┴───────────────────────────┴─┴──────────────────┘
```

- 三栏宽度都可拖动；两侧分隔条 2px，hover/focus 出现反相色和中央 grip，命中区向外扩 6px；支持键盘 ←→。
- 宽度持久化到 `localStorage`（`tian.navWidth` / `tian.contextWidth`）。拖动时过渡为 0，松手后恢复。
- 右栏可整体收起，收起后留 44px 竖条 + `»` 按钮；展开按钮 `«`。开合用宽度动画，内容保持固定宽度，避免挤压。
- 窗口 `titleBarStyle: hiddenInset`，红绿灯在左栏顶部 36px 的 drag 区里；每个 pane 的 header 都是 `-webkit-app-region: drag`，交互控件单独标 `no-drag`。
- 键盘流：`⌘K` 命令面板、`⌘N` 新会话、`⌘B` 开合右栏、`⌘,` 设置页、`⌘1/2/3/4` 切换 Chat/Goals/Skills/Inbox。

## 反例（不要这么做）

- 不要把黑白渐变铺到面板、卡片或大按钮上；它只属于标记、发送和进度。
- 不要给消息气泡加彩色背景或头像；品牌标记是身份锚点，不是头像。除 warning / destructive / diff 外，不要引入装饰性色相。
- 不要用 `shadow-xl` / 大面积毛玻璃表达层级；只有浮层和品牌标记允许轻阴影。
- 不要把 diff 放进弹窗；它属于右栏。
- 不要引入第二套图标库，也不要在组件里手写 SVG 图标。
- 不要用超过 400ms 的入场动画，或让动效阻塞点击/输入。

## 参考

- Coder 主题源码：`coder/coder` 仓库 `site/src/theme/`（`palette.ts`、`roles.ts`、`index.css` 里的 CSS 变量）
- [Phosphor Icons](https://phosphoricons.com/) — 统一图标家族
- [Streamdown](https://streamdown.ai) — Vercel 的流式 Markdown 渲染
- [Motion](https://motion.dev) — 动画库
- Beautiful UI（<https://www.beautifului.dev/>）的 AI 原语：tool chips、task rows、thinking trace
- Codex / Cursor 的三栏工作台布局
