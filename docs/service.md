# 常驻服务与升级

总管、工兵、调度与所有存储都跑在一个本机常驻 Node 服务里，由 launchd 管理。App 只是它的客户端；退出 App，服务照常工作。打包结构与一次完整升级的示例见 [D9](decisions.md#d9--app-与后台服务一起打包分开安装由独立升级器协调切换)。

## 安装与操作

首次安装或更新后端运行 `mise run service:install`（或 `pnpm service:install`），也可以在 App 设置的“服务与升级”里操作。安装器把完整构建产物和固定版本的 Node 运行时复制到独立 release；LaunchAgent 不依赖开发 checkout、系统 Node、终端或 Electron 进程。

| 操作                 | 命令                                       |
| -------------------- | ------------------------------------------ |
| 安装／更新并启动     | `pnpm service:install`                     |
| 查看状态与 PID       | `pnpm service:status`                      |
| 启动／停止           | `pnpm service:start` / `pnpm service:stop` |
| 重启                 | `pnpm service:restart`                     |
| 移除自启动，保留数据 | `pnpm service:uninstall`                   |
| 前台调试             | `pnpm build:service` 后 `pnpm service:run` |

默认位置：

- 数据目录：`~/Library/Application Support/Tian Agent/`（`TIAN_AGENT_DATA_DIR` 或 CLI `--data-dir` 可改），复用已有数据库与 Memory。
- LaunchAgent：`~/Library/LaunchAgents/dev.tian.agent.plist`。
- 服务产物：`<dataDir>/service/releases/<hash>/`。
- 日志：`<dataDir>/service/logs/service.log`。
- 连接：`<dataDir>/agent.sock`（`TIAN_AGENT_SOCKET_PATH` 可改）；socket 权限 0600，数据目录 0700。

App 与服务必须使用同一套目录与 socket 配置。存储和 socket 都有独占锁：旧版 App 还占用数据库时，新服务拒绝打开存储，需先退出旧版 App。模型密钥不写进 plist，用 `mise run service:env` 写入 `<dataDir>/service.env`（0600）后重启服务。

## 三个独立的状态

登录自启动、服务运行、App 连接互不绑定：

- App 启动时只按偏好连接已有服务，不会把已停止的服务拉起来。
- 退出 App 只断开连接；“断开本窗口连接”会持久保存不自动重连的偏好。
- 关闭登录自启动只移除 LaunchAgent 入口，保留安装目录中的定义；服务可手动启动，当前登录会话内崩溃仍会重启。
- 停止服务用 `bootout`，避免 KeepAlive 立即拉起；重新打开 App 不撤销停止。
- 系统休眠或关机期间无法执行任务。

## 服务升级

设置里的“服务与升级”在服务离线时也可用：查看 App／配套服务／运行服务版本，连接、断开、启动、停止、登录自启动、安装配套服务、恢复未完成升级。

仍有工作时拒绝停止或升级：操作前检查 Durable tasks、queued submissions、Runs 与验收操作。首次迁移没有版本信息的旧服务时，设置页会单独提示：旧版没有空闲检查，需先确认工作可以暂停并正常停止，再安装新版。数据保留；旧协议不再用于新版 App 的业务连接。

升级是一个事务：校验完整 release manifest（含动态 chunk、平台、架构、协议、数据库版本与独立 Node）→ 获取升级互斥锁并确认空闲 → 写入持久化维护标记 → 停止旧服务，在存储锁保护下备份数据库 → 启动新版（维护模式：不恢复任务、不投递 Inbox、不接受普通请求）→ 核对版本与维护状态后提交并恢复工作。

- 提交前失败：恢复数据库快照、旧服务定义和原运行状态。提交后不自动恢复旧数据库，只通过设置中的恢复入口继续完成激活；协调进程异常退出后也走该入口。
- 升级日志在 `<dataDir>/service/update.json`，维护标记在 `service/maintenance.json`，快照在 `service/backups/<transaction-id>/`。
- 升级成功后保留当前与上一份 release，以及最近三份数据库备份。Memory 文本格式不变，升级不替换其内容。

## App 升级

打包好的 macOS App 支持“导入新版 App…”：选择更高版本的 `.app`，升级器检查应用标识、版本、配套服务与平台架构。当前 App 有开发者签名时，新版必须由同一开发者签名并通过验证；本地未签名开发版本需在确认框中明确确认。App 所在目录必须可写。

确认后，独立升级进程等待旧 App 退出，在同一磁盘暂存并原子切换 App 目录。服务与 App 一起升级；未安装服务时只更新 App，已停止的服务升级后仍保持停止。新 App 完成 renderer 挂载与配套服务版本检查后，升级器才提交并解除维护状态；检查失败恢复旧 App 与服务。

目前升级来源是用户选择的本地 `.app`；远端版本检查、下载源、发布签名与公证尚未配置。
