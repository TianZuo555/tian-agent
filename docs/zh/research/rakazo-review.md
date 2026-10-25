# Rakazo 调研：Tian Agent 能否做同样的事

[English](../../research/rakazo-review.md) | **简体中文**

调研日期：2026-10-25。本文只做调研，记录分析与建议。它不改动 [docs/prd.md](../prd.md) 或 [docs/decisions.md](../decisions.md)。

## 结论

Tian Agent 可以做同一类产品。Bot 层我们已经接近。真正的缺口只有一层：**一个 agent 能看见、能操作的电脑**。

不要照抄 Rakazo 的技术栈。Rakazo 为自托管多用户服务器而建。Tian Agent 是单用户本地桌面应用加常驻服务。每一项能力的成本与收益都不同。

建议顺序：

1. **L0 只读浏览器工具**。成本最低，覆盖大部分价值。
2. **L1 受控浏览器加用户接管**。等 L0 证明有用后再做。
3. **L2 Docker 桌面沙箱**。跳过。把 Worker 的操作系统隔离当作独立决策处理。

有三件便宜的事不必等：聊天内产物附件、定时任务迟到说明、Chief 的结构化活动流。

## 调研依据

- `https://github.com/elie222/rakazo`，Apache-2.0，默认分支 `main`，2026-10-25 浅克隆检查。
- 规模：2,350 个 TypeScript 文件；含测试 584,909 行；不含测试 288,193 行；864 个测试文件。
- 主要阅读：`VISION.md`、`docs/run-execution.md`、`docs/computer-runtime.md`、`packages/adapters/src/builtin-tools.ts`、`packages/adapters/src/action-approval.ts`、`packages/adapters/src/web-ssrf.ts`、`packages/db/prisma/schema.prisma`、`infra/sandboxes/supervisor/src/egress-probe.ts`、`infra/compose/restrict-computer-egress.sh`。
- 对照阅读 Tian Agent：`README.md`、`docs/prd.md`、`CONTEXT.md`、`docs/decisions.md`、`package.json`、`src/worker/*`、`src/worker/agents.ts`。

## Rakazo 是什么

Rakazo 不是"带插件商店的聊天 agent"。它的产品内核是 **持久的 AI 队友 + 一台持久的个人电脑**。

| 层         | 它做了什么                                                                                                         | 位置                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 队友       | 每个 Bot 一条连续会话线程、记忆、routines、分组、归档、子 bot                                                      | `Bot`、`Thread`、`Routine`、`BotSection` 表                          |
| 执行       | Pi 跑在 API 进程内，工具是普通 Pi 工具                                                                             | `packages/adapters/src/pi-runtime.ts`                                |
| 电脑       | `SandboxProvider`（Docker、E2B、Daytona、Boat、Railway、CreateOS）给每个活跃 bot 独立 X display 与独立 Chrome 配置 | `packages/adapters/src/computer-*.ts`、`infra/sandboxes/supervisor/` |
| 屏幕       | noVNC 位于带令牌的 websocket 网关后；view 与 control 两套能力；数据库租约加 fence                                  | `docs/computer-runtime.md`                                           |
| 网页       | `browser_navigate`、`browser_snapshot`、`browser_act`，按元素 ref 操作                                             | `packages/adapters/src/builtin-tools.ts`                             |
| 终端与文件 | 绑定控制令牌的 PTY 服务、文件浏览器、活动流                                                                        | `computer.terminalUrl`、`computer.command` 事件                      |
| 外围       | Space、Better Auth、计费、Composio 与 Pipedream 连接器、MCP、Expo 与 Web 客户端                                    | `apps/*`                                                             |

对 Tian Agent 最关键的一点：**Rakazo 用的是和我们同一套 Pi 运行时**（`@earendil-works/pi-*` 1.3.0 对 `pi-durable`、`pi-ai` 1.3.0）。它的 agent 层设计可以直接借鉴，基础设施层不能。

## 能力对比

| 能力                    | Rakazo                  | Tian Agent                                | 差距         |
| ----------------------- | ----------------------- | ----------------------------------------- | ------------ |
| 常驻运行时              | API 进程加 worker       | launchd 常驻服务（D3）                    | 无           |
| 桌面客户端              | Electron 加 Web 加 Expo | 仅 Electron                               | 小           |
| 持久记忆                | 记忆加修订记录          | Core Memory 带证据、确认、预算（D4、D19） | **我们更强** |
| 目标、任务、调度        | routines 与 tickets     | Goals、Tasks、Schedules、看板             | **我们更强** |
| Agent 层级              | 父子 bot、子 agent      | Chief、Manager、Worker（D12、D18）        | 相当         |
| 代码隔离执行            | 每个电脑一个容器        | 仅 Git worktree（`docs/prd.md` §7.3）     | **真实缺口** |
| 浏览器与界面操作        | 完整方案                | 无；Chief 没有 shell 工具                 | **真实缺口** |
| 聊天内产物              | Artifact 表加附件       | 落盘报告文件                              | 缺口，但易补 |
| 多用户、计费、SaaS 集成 | 有                      | 明确非目标（`docs/prd.md` §1.4）          | 不算缺口     |
| 移动端                  | Expo                    | 无                                        | 暂为非目标   |

这样读这张表：Rakazo 第一个版本投入的那一层，我们已经有了。Rakazo 主要工作量所在的那一层，我们没有。

## 真正难的部分

GUI 栈是 Rakazo 的重量所在：

- `packages/adapters` 含测试约 20 万行。其中很大一部分是电脑、浏览器、沙箱 provider 及其一致性测试套件。
- `infra/sandboxes` 里有一个 Docker supervisor，管理 X display、每 bot 的 Chrome 配置、noVNC 传输、PTY 服务、剪贴板桥、跨版本配置持久化，以及配置检查点的 generation fence。
- `docs/computer-runtime.md` 记录了需要真实踩坑才能发现的失效模式：Android 上存在 WebCodecs 时 noVNC 会挂住、重复帧必须从模型上下文里去掉、过期元素 ref 必须拒绝而不是改指、显示槽位复用前必须先完成拆除。

这些都不是周末能移植的。其中大部分存在的理由，是 Rakazo 用一台服务器服务多个租户。

Tian Agent 没有这个约束。桌面应用本来就跑在要承载浏览器的那台机器上。这直接消掉了整个远程屏幕问题。

## Rakazo 值得抄的部分

### 1. 元素 ref 工具优先于像素工具

Rakazo 给模型 `browser_snapshot`（无障碍风格树，元素带 `e1`、`e2` 等 ref）与 `browser_act`（click、fill、type、upload、fill_secret）。通过 `computer_act` 的像素点击存在，但工具描述要求模型在网页上优先用 ref，只有在页面工具明确拒绝时才退回像素。这个顺序是对的：ref 工具更便宜、更稳定、更容易审计。

### 2. 屏幕访问三分：view、control、takeover

- view 是只读能力。
- control 是独立能力，同一时刻只有一个持有者，由租约保证。
- `request_takeover` 在需要受保护输入时向人申请独占控制：密码、二次验证、验证码、需要判断的选择。

这正好对应 Tian Agent 的一项需求：用户必须能看见、能打断。租约模型很小，即使在本地应用里也值得保留。

### 3. 运行是否被外部内容污染

`packages/core/src/action-approval.ts` 把工具结果分成两类：一类是产品自身状态（记忆、历史、密钥列表），另一类是外部文本（网页、shell 输出、连接器、其它 bot）。第二类会**污染该次运行**。运行被污染后，在本次运行尚未用过的连接器上做读取需要审批，因为注入的文本此时可以决定参数。`outboundSiteGate` 对 `web_fetch` 用同一思路：用户自己说过的站点可信；外部内容进入运行后才选出的站点不可信。

Tian Agent 没有等效规则。Worker 的提示词写着"不要 push"，那只是指令，不是边界（`docs/prd.md` §7.3 也承认这点）。污染规则只有几百行，能把提示纪律变成强制。这一条与选哪个 L 级无关，都应抄。

### 4. 密钥不进入模型上下文

`request_secret` 向用户展示卡片。值存在服务端，`browser_act fill_secret` 只把它填入保存时对应的源。模型永远看不到值。命令类凭据则以环境变量形式导出给 shell。

Tian Agent 的 Chief 今天完全没有凭据通道。任何 GUI 能力都必须配一条这样的规则，否则 agent 输入的第一个密码就是对话记录里的永久泄露。

### 5. 离开本机的一切默认拒绝

`web-ssrf.ts` 在 DNS 解析后拒绝私有、回环、链路本地与 metadata 地址，每个重定向跳点都重新检查，并限制响应体大小与重定向次数。对完整电脑，`restrict-computer-egress.sh` 阻断 Docker 宿主、RFC1918、CGNAT、链路本地与组播，而 `egress-probe.ts` **在第一台受限电脑启动前就证明规则存在**。证明失败时电脑拒绝启动，而不是以开放状态运行。

最后这一点是设计教训：不要假设防火墙规则存在。要验证它，并失败即关闭。

### 6. 定时任务的迟到说明

`docs/run-execution.md` 说明：如果定时运行比预定时间晚超过 15 分钟启动，就要把两个时间都告诉 agent，时区用 routine 自己的。agent 才能据此调整，而不是以为现在就是预定时间。Tian Agent 的调度器（`src/worker/scheduler.ts`）没有这条规则。这是很小的提示词改动，效果真实。

### 7. 产物属于会话线程，而不是文件系统

Rakazo 有 `Artifact` 表，挂在 bot、group、run、thread 上。生成的图片、视频、图表与文件都进入聊天。Tian Agent 把 `TIAN_REPORT.md` 写进 worktree，再用 `read_run_report` 读回。中间环节能用，但用户永远看不到 agent 生成的图。

## Tian Agent 应当分歧的地方

### 跳过 Docker 桌面沙箱

Rakazo 需要 Docker，因为它的电脑服务远程用户。Tian Agent 的电脑就是用户坐着的那台机器。一个本地隐藏 `BrowserWindow` 就能提供同样的观察与操作能力，没有容器、没有 noVNC、没有 X display、没有每 bot 的 Chrome 配置、没有 supervisor、没有屏幕网关。

同时用上主机已有的东西。`cua-driver` 技能通过无障碍树与窗口几何驱动真实 macOS 应用。这覆盖了 Rakazo 用整套 Linux 桌面镜像解决的"操作 GUI 应用"场景，代价只是一次进程调用。

### 代码边界仍然只有 worktree，并且要说明

Tian Agent 的 PRD 已把这一点列为待决（§13 第 8 问）。不要把那个决策捆进 GUI 工作里。如果 Worker 隔离值得解决，就围绕 shell 工具做专用沙箱。不要为了拿到它而引入一整套桌面栈。

### 保留记忆设计

Rakazo 的记忆比 Tian Agent 薄。它只有 `MemoryDocument`、`MemoryRevision` 和 Bot 上一个 memory scope 字符串。Tian Agent 有来源、证据、确认、取代、显式 Core 选择、按 Scope 预算、独立的相关性预算与审阅界面（D4、D18、D19）。在引入文件和 GUI 控制时，不要向 Rakazo 的模型回退。

## 建议阶段

### L0：只读浏览器（约 1 至 2 千行）

- Electron 主进程里开隐藏 `BrowserWindow`，独立 session 分区（`persist:agent`），不使用用户配置。
- `browse(url)` 加载页面、等待空闲，返回标题、抽取的正文，以及带 ref 的有界可交互元素列表。
- `snapshot()` 返回同样结构但不导航。
- 截图用 `webContents.capturePage()`。只有当 Magpie 目录中该模型的 `modalities.input` 含 `image` 时才发送图片字节（`src/worker/magpie.ts` 已解析此字段）。
- 新 Pi extension，两个工具。只给 Chief 与 Manager。此阶段不给 Worker。
- 设置里的域名允许列表。默认只允许公开网页。DNS 解析后拒绝私有、回环、链路本地与 metadata 目标，每个重定向跳点都拒绝。
- 限制页面大小、元素数量与硬超时。拒绝过期 ref。

价值：Chief 能读文档、查服务状态、看 PR 讨论、打开缺陷报告。这些都不需要容器。

成本：一个 extension、一个主进程模块、一条 IPC 通道、一行设置、测试。没有新进程、没有镜像、没有 Docker。

### L1：受控浏览器加接管（约 3 至 6 千行）

- 加 `act(click/fill/type/upload by ref)` 与 `request_takeover()`。
- 用 `WebContentsView` 把 agent 的浏览器嵌进 Context Pane，用户能看见。
- 单一持有者租约：agent 或用户，二者之一。运行结束、超时、窗口关闭时释放。
- 凭据卡片：用户在应用里输入密钥；agent 只能把它填入保存时对应的源。
- 污染追踪：任何页面或 shell 结果进入运行后，运行未被指定过的外发目标需要审批。

真正的安全评审在这里。L0 没有显示出实际使用前，不要开始。

### L2：跳过

没有 Docker supervisor、没有 X display、没有 noVNC、没有每 bot 的 Chrome 配置、没有多 provider 沙箱抽象。只有当 Tian Agent 变成多用户产品或增加远程服务器模式时才重新考虑。两者都在 `README.md` 的路线图中，所以把这条记成带触发条件的决策，而不是永久否决。

### 立即可做的小项（与 L 级无关）

1. 产物附件：允许 agent 把图片与文件挂到消息上，Chat 视图能渲染。
2. `src/worker/scheduler.ts` 的迟到说明：唤醒晚于 15 分钟时，把预定时间与实际时间都告诉 agent。
3. Chief 的结构化活动事件：今天 `run_progress` 只覆盖 Worker。把同一事件形态扩展到 Chief 的工具调用，让用户看到 Chief 做了什么。

## 待定问题

1. **视觉模型可用性。** Magpie 至少要暴露一个目录条目里 `modalities.input` 含 `image` 的模型。没有的话，L0 只能走 DOM 文本。规划截图前先查在线目录。
2. **Chief 的权限模型。** Chief 目前按设计没有 shell、没有写文件的工具（`docs/prd.md` §7.3）。一个带任何已登录状态的浏览器会改变这个姿态。L1 之前必须决定：agent 的浏览器是否可以共享用户 cookie。
3. **归属。** 浏览器工具属于 Chief extension（`src/worker/tools.ts`），还是像 `CodingTools` 那样做成共享 extension 同时给 Chief 与 Manager？后者与 Rakazo 一致，并且只有一份实现。
4. **常驻服务与 Electron 主进程。** 隐藏浏览器必须活在能创建 `BrowserWindow` 的 Electron 主进程里，而常驻服务拥有全部状态（`docs/prd.md` §3.1）。要在 `src/shared/contracts.ts` 里定义 IPC 契约，让服务保持权威，浏览器只是工具端点，而不是第二个写入者。

## 参考

- Rakazo：`https://github.com/elie222/rakazo`
- Rakazo 愿景：该仓库的 `VISION.md`
- Rakazo 电脑运行时：该仓库的 `docs/computer-runtime.md`
- Tian Agent 决策：[D3](../decisions.md)、[D4](../decisions.md)、[D18](../decisions.md)、[D19](../decisions.md)
- Tian Agent 架构：[docs/architecture.md](../architecture.md)
