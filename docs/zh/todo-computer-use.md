# Agent 浏览器与电脑操作（TODO 与路线）

[English](../todo-computer-use.md) | **简体中文**

本文档把 [Rakazo 调研](research/rakazo-review.md) 的建议落成可跟踪的工作。调研文档记录分析与理由；本文档记录顺序、各阶段范围与实施清单。

---

## 1. 目标

让总管与项目管理者拥有一台能看见、能操作的电脑，而不引入容器栈。Tian Agent 是单用户桌面应用，这台电脑就是用户面前的机器。一个隐藏的 Electron `BrowserWindow` 就能提供 Rakazo 靠 Docker、X display 与 noVNC 才得到的观察与操作能力。

工兵隔离是另一项决策，见 [todo-worker-sandbox.md](todo-worker-sandbox.md)，不要捆绑进本项工作。

## 2. 顺序

| 阶段         | 范围                                      | 开始条件                           |
| ------------ | ----------------------------------------- | ---------------------------------- |
| 小项         | 产物附件、迟到说明、总管活动流            | 现在；与浏览器阶段无关             |
| Run 污染规则 | 外部文本污染 Run；被污染的 Run 行动需审批 | 现在；L1 之前必须完成              |
| L0           | 总管与项目管理者的只读浏览器工具          | 现在                               |
| L1           | 受控浏览器、用户接管、凭据卡片            | L0 证明有实际用途，并完成安全评审  |
| L2           | Docker 桌面沙箱                           | 跳过；仅在 §7 的触发条件出现时重议 |

## 3. 小项（与浏览器无关）

- [ ] **产物附件。** agent 可以把图片与文件挂到消息上，Chat 视图负责渲染。现在工兵只写 `TIAN_REPORT.md`，用户看不到 agent 生成的图片。编码前先定存储位置与消息 entry 的形态。
- [ ] **定时唤醒的迟到说明。** Schedule 唤醒比预定时刻晚 15 分钟以上时，唤醒通知按 Schedule 的时区写明预定时间与实际时间。`src/worker/scheduler.ts` 目前没有这条规则。
- [ ] **总管活动流。** `run_progress` 只显示工兵的最近输出与工具调用。用同一种事件形态记录总管与项目管理者的工具调用，让用户看到它们做了什么。

## 4. Run 污染规则

Rakazo 把工具分成两组：结果是产品自身状态的工具，和结果携带外部文本的工具。第二组的结果会污染当前 Run。此后，目标或参数不是用户给出的行动都需要审批，因为注入的文本可能正在替 agent 做选择。

- [ ] 列出 Tian Agent 的污染来源：inbox 消息、非 Tian 本人的 Telegram 与微信输入、Run 报告与 diff、非 agent 自己写的 notes 与文件，以及（从 L0 起）网页。
- [ ] 列出受控行动：派发工兵、`send_run_msg`、委派项目管理者，以及（从 L0 起）访问用户未指名的网站。
- [ ] 建立在审批工作之上（PRD 场景 F，分支 `m3-approvals`）。按 turn 记录污染状态，与现有 provenance（`src/worker/provenance.ts`）放在一起。
- [ ] 测试：被污染的 turn 未经审批不能派发；未被污染的用户 turn 可以。

## 5. L0：只读浏览器

- [ ] 在 Electron 主进程里建一个隐藏的 `BrowserWindow`，使用独立 session 分区（`persist:agent`），绝不使用用户自己的 profile 或 cookie。
- [ ] `browse(url)`：加载页面、等待空闲，返回标题、提取的正文，以及带 ref（`e1`、`e2`……）的有限个可交互元素。`snapshot()` 不导航，返回同样结构。
- [ ] 截图用 `webContents.capturePage()`。只有当模型目录条目的输入模态含 `image` 时才发送图片字节（`src/worker/magpie.ts` 已经解析 `modalities.input`）。
- [ ] 新建一个包含这两个工具的 Pi extension，给总管与项目管理者；本阶段不给工兵。
- [ ] 网络规则：默认只允许公网，并在 Settings 中提供域名白名单。DNS 解析后拒绝私网、回环、链路本地与云元数据地址，每一跳重定向都要检查。启动时验证规则，验证失败即拒绝。
- [ ] 限制：页面最大尺寸、元素最大数量、硬超时。拒绝过期 ref，绝不自动改指向。
- [ ] IPC 契约放在 `src/shared/contracts.ts`。常驻服务仍是唯一状态拥有者；浏览器只是工具端点，不是第二个写入者。
- [ ] 测试：白名单与私网拒绝、重定向检查、各项限制、过期 ref 拒绝、桌面 App 关闭时的工具可用性（见 §8 第 1 问）。

## 6. L1：受控浏览器与接管

只有在 L0 证明有实际用途并完成安全评审后才开始。

- [ ] 按元素 ref 执行 `act(click | fill | type | upload)`；遇到密码、2FA、CAPTCHA 或需要判断时用 `request_takeover()`。
- [ ] 用 `WebContentsView` 把 agent 的浏览器嵌进 Context Pane，用户可以旁观并打断。
- [ ] 单持有者租约：同一时间只有 agent 或用户控制页面。Run 结束、超时或窗口关闭时释放。
- [ ] 凭据卡片：用户在 App 里输入密钥，服务保存，agent 只能把它填进保存时对应来源的字段。值永远不进入模型上下文或 transcript。
- [ ] Run 污染规则（§4）约束对外目标。

## 7. L2：Docker 桌面沙箱（跳过）

不做 Docker supervisor、X display、noVNC、每个 bot 的 Chrome profile，也不做多供应商沙箱抽象层。**重议的触发条件：** Tian Agent 变成多用户产品，或实现 README 路线图里的远程服务器模式。届时把它记录为带触发条件的决策。

浏览器以外的 GUI 应用：在考虑任何桌面镜像之前，先评估把 `cua-driver` CLI（macOS 无障碍树与窗口几何）作为工具端点。

## 8. 待定问题

1. **没有桌面 App 时的可用性。** 常驻服务由 launchd 运行，不依赖 Electron App（D3、D9），而 `BrowserWindow` 只存在于 Electron 主进程。需要决定：App 关闭时工具不可用、服务启动一个无界面的 Electron 辅助进程，还是由其他运行时承载浏览器。
2. **视觉模型。** Magpie 至少要提供一个支持 `image` 输入的模型；否则 L0 只能用 DOM 文本。规划截图前先查在线目录。
3. **总管权限。** 总管按设计没有 shell 与写文件工具。带任何登录状态的浏览器都会改变这一点。L1 之前要决定 agent 的浏览器是否可以共享用户 cookie。
4. **归属。** 浏览器工具放在总管 extension（`src/worker/tools.ts`），还是像 `CodingTools` 一样做成总管与项目管理者共用的一个 extension。共用形式只有一份实现。
