# Tian Agent

一个长期在线的个人 Agent：一位总管（Chief）负责记忆、规划与汇报，按项目划分 scope；代码类任务交给在 Git worktree 中无人值守执行的工兵（Worker）。总管与工兵之间有双向消息通道：工兵可以边执行边提问并等待答复，总管也能中途下达指令。

总管运行在本机常驻 Node 服务中（launchd 管理，崩溃自动重启）；Electron App 是它的桌面客户端，Telegram Bot 是另一个聊天入口。会话可以结束，记忆、目标和责任不会消失。

产品需求与路线图见 [docs/prd.md](docs/prd.md)，术语见 [CONTEXT.md](CONTEXT.md)，架构决策见 [docs/adr/](docs/adr/)。

## 功能一览

- **聊天**：持久会话，Markdown 与 Mermaid 渲染，⌘K 命令面板。
- **模型**：从 Magpie 网关自动发现模型并在 App 内切换；网关不在线时使用缓存的模型目录。用量按天统计，Settings 中以热力图展示。
- **项目与 scope**：手动注册本地目录为项目；任务默认在隔离 worktree 中执行。
- **记忆**：SQLite 存储，带来源、可信度与版本；后台自动提取候选记忆，App 内晋升、驳回或修订。
- **目标与任务**：用户管理目标，Agent 管理任务；cron 调度唤醒 Goal，每日预算与用户提醒。
- **Run 与验收**：工兵在 worktree 中执行，支持多轮 follow-up；Land / Ship / Discard 验收。
- **双向消息**：工兵 `ask_chief` 提问等待答复，总管 `send_run_msg` 回复或下达指令，线程持久化。
- **多入口**：App、Telegram 与 Inbox 文件邮箱各自独立会话，共享同一份 scope 记忆。
- **常驻服务**：独立于 App 安装与升级，服务升级带回滚，App 支持导入新版并配套升级（见 [docs/service.md](docs/service.md)）。
- **改进日志**：产品问题、摩擦、想法与成功经验；运行时异常自动去重记录，可提升为 Task。

## 快速开始

```sh
mise install
mise run setup    # pnpm install + pnpm service:install
mise run start    # 启动 App
mise run verify   # typecheck + lint + react-doctor + test
```

工具链（Node 26 + pnpm 12.5.1）、环境变量与测试详见 [docs/development.md](docs/development.md)。

## 文档

| 文档                                               | 内容                                          |
| -------------------------------------------------- | --------------------------------------------- |
| [docs/development.md](docs/development.md)         | 工具链、任务、环境变量、测试与 React 代码质量 |
| [docs/architecture.md](docs/architecture.md)       | 进程模型、桌面客户端、模块地图、权限与 scope  |
| [docs/service.md](docs/service.md)                 | 常驻服务：安装、操作、升级与回滚              |
| [docs/channels.md](docs/channels.md)               | 渠道与会话绑定，Telegram 接入，Inbox          |
| [docs/memory.md](docs/memory.md)                   | 记忆系统与自动提取                            |
| [docs/agent-work.md](docs/agent-work.md)           | 目标、任务、调度、Run 与总管 ⇄ 工兵消息       |
| [docs/data.md](docs/data.md)                       | 存储、恢复、通知、History 与 Event            |
| [docs/improvement-log.md](docs/improvement-log.md) | 改进日志                                      |

## 后续

当前通过 Magpie 网关接入模型。Keychain、远程服务、本机／云端协议、更多工兵类型、定时简报、远端自动更新源、发布签名与公证仍待实现。

参考：[Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)、[OptMem](https://github.com/VictorTaelin/OptMem)、[launchd](https://www.launchd.info/)、[coss](https://coss.com/ui)。
