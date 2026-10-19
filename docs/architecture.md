# 架构

## 进程

| 进程     | 职责                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Renderer | React + Tailwind + coss。维护展示状态与订阅，拒绝过时响应；聊天使用应用自己的 `ChatSnapshot`                  |
| Preload  | 通过 `contextBridge` 暴露共享类型的命令和可取消订阅；保持 sandbox 与 context isolation，关闭 Node integration |
| Main     | 管理窗口、目录选择和 IPC 转发，通过 Unix socket 连接常驻服务；不打开数据库                                    |
| 常驻服务 | 唯一持有应用数据库与 Pi storage；执行模型调用、工具、Inbox、通知和 Run。客户端重连后重新获取快照与订阅        |

总管、项目管理者和工兵共用服务内的 Harness 与 Pi storage，各自显式选择 extension。工兵与项目管理者都是 Durable 会话，生命周期与桌面客户端独立。

## 桌面客户端

- 主导航：Chat、Goals、Skills、Inbox 四个视图；侧栏底部的齿轮或 `⌘,` 打开整页 Settings（再次按下或点关闭按钮回到来源视图）。侧栏与右栏都能折叠：侧栏 `⌃⌘S`，右栏 `⌘B`，开关都在内容区标题栏。
- 会话归档：侧栏会话行 hover 出现 Archive / Restore（`archiveConversation`），归档会话收进底部 Archive 区；归档后不再作为 Scope 级唤醒目标。
- 跨 scope 看板：Goals 视图统一展示所有 scope 的 goals / tasks / notices，Inbox 视图同理，条目带 scope 徽标。
- Context Pane：Tasks / Runs / Memory 标签页（跟随当前会话的 scope）。Memory 面板区分候选、Core 与可检索未常驻条目，显示 Core 用量，可直接晋升、驳回、选入/移出、修订（`memoryPromote` / `memoryDismiss` / `memorySelect` / `memoryDeselect` / `memoryRevise`）。
- ⌘K 命令面板：新建会话、切换视图、开关侧栏与 Context Pane。
- Settings 页：模型选择与 Gateway 状态、用量统计热力图、改进日志（Log）、服务与升级（见 [service.md](service.md)）。
- 聊天渲染：Streamdown 输出 Markdown，Mermaid 图表按需懒加载。
- App 组件必须通过 oxlint 的 `jsx-a11y` 规则（error 级，见 `.oxlintrc.json`）。

## 模块地图

| 模块                           | 职责                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `service/server.ts`            | 服务生命周期、独占锁、Unix socket RPC、客户端隔离                                  |
| `service/client.ts`            | 请求、事件、自动重连；关闭客户端不停止服务                                         |
| `service/launchd.ts`           | 服务升级事务、备份、回滚、恢复与 LaunchAgent 管理                                  |
| `desktop/controller.ts`        | App 连接偏好、服务控制及本地升级入口                                               |
| `desktop/app-update.ts`        | App 校验、独立替换、启动检查与失败恢复                                             |
| `shared/contracts.ts`          | IPC / socket 参数 schema、返回类型和消息合约                                       |
| `shared/messages.ts`           | Pi transcript 转换为聊天快照                                                       |
| `worker/service.ts`            | 应用组装、项目、总管会话、渠道绑定、Inbox 与通知                                   |
| `worker/commands.ts`           | 各 transport 共用的业务命令                                                        |
| `worker/agents.ts`             | Pi API 适配和总管／工兵能力配置                                                    |
| `worker/magpie.ts`             | Magpie 网关 provider：模型发现与描述映射                                           |
| `worker/settings.ts`           | 模型选择与缓存的模型目录                                                           |
| `worker/tools.ts`              | 总管 extension：task、memory、notes、Inbox、dispatch、delegate 等                  |
| `worker/manager-tools.ts`      | 项目管理者 extension：项目锁定的 task、memory、notes、runs、report_chief 等        |
| `worker/tools-memory.ts`       | 总管／项目管理者共用的记忆工具与 scope 解析                                        |
| `worker/tools-goals.ts`        | 总管目标工具：create_goal、update_goal、list_goals                                 |
| `worker/tools-improvements.ts` | 总管改进工具：log_improvement、list_improvements                                   |
| `worker/tools-history.ts`      | 总管检索工具：search_history、read_history                                         |
| `worker/worker-tools.ts`       | 工兵消息工具：ask_chief、tell_chief、check_msgs                                    |
| `worker/goals.ts`              | Goal 存储、用户提醒（`user_notices`）与每日预算                                    |
| `worker/scheduler.ts`          | cron 解析与触发事务                                                                |
| `worker/runs.ts`               | Run 状态、attempt、收集、恢复及验收                                                |
| `worker/data.ts`               | task、memory、Inbox 操作和更新事件                                                 |
| `worker/db.ts`                 | 业务数据、渠道绑定、通知 outbox、幂等记录                                          |
| `worker/scopes.ts`             | scope 目录、notes 和 Inbox 文件导入                                                |
| `worker/memory.ts`             | SQLite 记忆、来源与版本、显式 Core 选择（见 [memory.md](memory.md)）               |
| `worker/provenance.ts`         | 用户来源证据校验（区分用户轮次与系统唤醒）                                         |
| `worker/search.ts`             | Memory / History / Notes 共用的查询计划、Token 估算与 code point 分页              |
| `worker/memory-worker.ts`      | 后台候选记忆提取：触发、游标、启发式提取器                                         |
| `worker/history.ts`            | transcript 与事件的派生全文索引、增量同步与检索                                    |
| `worker/events.ts`             | 业务事件与审计日志（`events` 表）                                                  |
| `worker/improvements.ts`       | 改进日志、异常指纹去重、提升为 Task（见 [improvement-log.md](improvement-log.md)） |
| `worker/usage.ts`              | 按本地日统计各 scope 的模型 token 用量                                             |
| `worker/dispatch.ts`           | worktree、commit、diff、merge 和 PR 命令                                           |
| `worker/telegram.ts`           | Telegram Bot 长轮询、白名单、会话映射与回复转发                                    |

## 权限与 scope

总管只启用 chief extension：task、memory、notes、Inbox、改进日志、dispatch、delegate（`delegate` / `send_manager_msg` / `list_manager_msgs`）、Run 查询与 Run 消息（`send_run_msg` / `list_run_msgs`），没有 `bash/read/write/edit`；读取 Run 结果用 `read_run_report` / `read_run_diff`。启动时会重新限制已有总管会话的 extension。

项目管理者启用 manager extension，由 `channel_sessions` 中 `channel = 'manager'`、`external_id = project_id` 的绑定决定，每项目一条持久会话，首次 `delegate` 时惰性创建；`channel = 'manager'` 是保留 channel，公开 `openSession` 不能绑定它。它的工具全部锁定本项目 scope：任务执行（`delegate` 产生的 `assignee='manager'` Task 归它收口，总管不再能 start/complete/fail）、Run 管理（`dispatch` 只许本项目的 Task，把 `chief_conversation_id` 指到自己，工兵的提问与结果回到管理者）、记忆写入只许本项目（可读 Global），notes 与 history 同理；没有 shell / 编码工具。上行用 `report_chief` / `ask_chief` 走 `manager_messages` 持久线程（kind/task_id/reply_to/closed_at），通知按委派 Task 的 `report_to` 路由到对应总管会话。

工兵启用 CodingTools 加消息 extension，默认在 Git worktree 中工作，没有总管的 memory 写入工具。工兵可执行中用 `ask_chief` 提问并阻塞等待答复，用 `tell_chief` 发进度通知，用 `check_msgs` 接收总管指令。工兵被要求仅编辑当前目录、只读共享 memory/notes；worktree 提供 Git 目录隔离，不提供操作系统文件访问沙箱。

Scope 分为 `global` 和手动注册的项目。会话绑定 scope，总管可通过工具跨 scope 查询。项目设置包含 `autoLand`、`allowInPlace`、`runTimeoutMin`、`baseBranch`、`promptPreamble`；当前工兵类型为 `durable-worker`。
