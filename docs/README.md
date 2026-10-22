# Tian Agent

[English](../README.md) | **简体中文**

一个长期在线的个人 Agent：一位总管（Chief）负责关于 Tian 与跨项目的记忆、规划与汇报，按项目划分 scope；每个项目都有一位随项目创建、必须命名的管理者（Manager），掌管本项目的详细记忆并承接总管的委派，代码类任务最终交给在 Git worktree 中无人值守执行的工兵（Worker）。各层之间都有双向消息通道：工兵可以边执行边提问并等待答复，上级也能中途下达指令。

总管运行在本机常驻 Node 服务中（launchd 管理，崩溃自动重启）；Electron App 是它的桌面客户端，Telegram Bot 与微信（iLink / ClawBot）是远程聊天入口。会话可以结束，记忆、目标和责任不会消失。

产品需求与路线图见 [docs/prd.md](prd.md)，术语见 [CONTEXT.md](CONTEXT.md)（[英文原版](../CONTEXT.md)），设计决策见 [docs/decisions.md](decisions.md)，视觉语言见 [docs/design-language.md](design-language.md)。

## 功能一览

- **三栏工作台**：导航 / 对话 / 上下文检查器（Tasks / Runs / Memory）三栏布局；Streamdown Markdown 与按需懒加载的 Mermaid 图表，全局 ⌘K 命令面板，无缝折叠与暗色/亮色外观。
- **模型与网关**：从本机 Magpie 网关自动发现模型（`/v1/models`）并在 App 内切换；离线时使用缓存目录；用量按天统计并以热力图展示。支持在派发 Run 时单独钉选 worker 模型与思考强度（D13）。
- **项目与 Scope**：手动注册本地目录为项目；每个项目恰好一位管理者，注册时名称必填（D18）；任务默认在隔离 Git worktree 中执行。
- **分层记忆系统**：SQLite 存储，区分来源（用户确认、Agent 推断、第三方数据）、可信度与版本历史；显式 Core Memory token 预算控制；后台 Memory Worker 自动提取候选记忆，App 内一键晋升、驳回、选入/移出或修订。Global 记忆与 Notes 归总管，项目记忆与 Notes 归该项目管理者；总管会话只注入 Global Core，管理者会话注入 Global 与本项目 Core（D4, D18）。
- **目标与任务**：用户管理目标，Agent 管理任务；cron 表达式调度唤醒 Goal；每日执行预算与用户提醒去重。
- **Run 与验收**：工兵在 worktree 中执行代码任务，支持多轮 follow-up；用户可随时 Land（合入本地）、Ship（推送并提 PR）或 Discard（丢弃）；同一派发者的重复派单自动折叠（D15）。
- **实时进度与安全中止**：总管与管理者可通过 `run_progress` 实时查看工兵最新输出与近期工具调用；通过 `stop_run`（或 UI 停止按钮）优雅中断执行，保留 worktree、分支与半成品提交供后续审查与继续（D15, D16）。
- **双向消息通道**：工兵通过 `ask_chief` 提问并阻塞等待答复，总管通过 `send_run_msg` 回复或主动下发指令，线程持久化存储。
- **项目管理者**：每项目一条专属持久会话，随项目注册创建，名称必填。总管以 Task 为单位委派工作，管理者执行、收口并汇报；Tian 也可从侧栏直连管理者会话派活，直派任务静默收口、不干扰总管（D12, D18）。
- **多渠道接入**：桌面 App、Telegram Bot（long polling + 白名单 chat）、微信（官方 ClawBot / iLink 扫码通道，24 小时保活与会话游标）与 `.tian/inbox` 文件邮箱各自独立会话，共享同一份全局/项目记忆（D8, D17）。
- **常驻服务与安全升级**：独立于 App 安装运行，launchd 崩溃自动拉起；支持带数据库快照与自动回滚的事务性服务升级，App 内支持导入新版并配套升级（D3, D9）。
- **改进日志**：集中记录产品问题、使用摩擦、想法与成功经验；运行时异常自动脱敏并按指纹去重合并，可一键提升为 Task（D11）。

## 快速开始

```sh
mise install
mise run setup    # pnpm install + pnpm service:install
mise run start    # 启动桌面 App
mise run verify   # typecheck + lint + react-doctor + test
```

工具链（Node 26 + pnpm 12.5.1）、环境变量与测试矩阵详见 [docs/development.md](development.md)。

## 文档索引

| 文档                                                        | 内容                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| [docs/development.md](development.md)                       | 工具链（mise）、常用任务、本地环境变量、完整测试套件与代码质量要求 |
| [docs/decisions.md](decisions.md)                           | 架构设计决策 D1–D18：取舍与设计原由                                |
| [docs/architecture.md](architecture.md)                     | 进程模型、桌面客户端、模块地图、权限与 Scope 隔离                  |
| [docs/service.md](service.md)                               | 常驻服务：安装、操作、独占锁、升级事务与回滚机制                   |
| [docs/agent-work.md](agent-work.md)                         | 目标、任务生命周期、调度、Run 状态机、管理者与工兵消息             |
| [docs/memory.md](memory.md)                                 | SQLite 记忆体系、显式 Core Memory、来源（Provenance）与自动提取    |
| [docs/channels.md](channels.md)                             | 渠道与会话绑定、Telegram / 微信接入配置与 Inbox 文件邮箱           |
| [docs/data.md](data.md)                                     | 数据库表设计、恢复机制、通知投递、History 全文检索与 Event 审计    |
| [docs/improvement-log.md](improvement-log.md)               | 改进日志：条目生命周期、异常指纹去重与任务提升                     |
| [docs/prd.md](prd.md)                                       | 产品需求文档（PRD）：定位、核心对象、需求矩阵与路线图              |
| [docs/design-language.md](design-language.md)               | 视觉语言规范：墨色表面、单色强调、Coder token 与 Phosphor 图标     |
| [docs/research/memory-review.md](research/memory-review.md) | 记忆系统对比调研：OpenClaw、Hermes 与 Tian Agent 设计对比          |

## 后续规划

当前通过 Magpie 网关统一接入模型。Keychain 凭据保护、远程服务连接、本机／云端多端协议、更多类型的专用工兵、定时简报提炼、远端版本检查与自动更新源、macOS 发布代码签名与公证仍在开发计划中。

参考：[Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)、[OptMem](https://github.com/VictorTaelin/OptMem)、[launchd](https://www.launchd.info/)、[coss](https://coss.com/ui)。
