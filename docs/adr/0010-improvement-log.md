# 改进日志：用户与总管可写、系统错误自动指纹化

Improvement Log 是 `tian.db` 中一张独立的 `improvements` 表，记录值得改进的产品问题、使用摩擦、想法和成功经验；系统异常也会自动落入同一张表，并按指纹合并。它不是审计 Event，也不是注入 Prompt 的 Memory。

## 背景

项目已经有 `events` 表记录 Run、Inbox、通知等业务事实，也有 `<dataDir>/service/logs/service.log` 记录进程输出。但两者都不能回答“哪里值得改”：

- `events` 是 append-only 的审计事实，不适合承载“这个交互很烦”或“这里可能是个 bug”的判断。
- `service.log` 是 launchd 重定向的原始 stdout/stderr，没有结构化上下文、没有去重、没有状态，也不会出现在 App 里。
- 用户反馈和总管在工作中观察到的摩擦，目前只能停留在会话里，结束后就难以再次找到。

因此需要一条产品内的、可 triage 的改进记录流，同时让真正的运行时异常自动出现，而不是只留在终端日志中。

## 决定

- **对象与归属**：一条 Improvement Entry 属于一个 Scope（`global` 或项目），字段包括 `kind`（`issue` / `friction` / `idea` / `win`）、`status`（`open` / `promoted` / `resolved` / `dismissed`）、`severity`、`summary`、`detail`、`source`（`user` / `chief` / `system`），以及可选的 `area`、`fingerprint`、`occurrences`、`first_seen_at`、`last_seen_at`、`task_id` 和 `conversation_id` / `run_id` / `event_id` 引用。细节正文最多 20k 字符，列表只返回摘要，展开时再取正文。
- **两个写入面**：总管的 `log_improvement` 工具和 App 的 Log 视图都写入同一张表；总管在用户明确反馈或自己观察到可复用问题时记录，`source` 区分用户报告与总管自述。UI 手工写入固定为 `user`。
- **自动捕获**：服务内有一个 `reportIssue(area, error, context)` 汇点，替换原先只写 `console.error` 的关键错误路径（服务启动/监听、Inbox 扫描与 watcher、History 同步、通知投递、调度器、Run 启动/失败/恢复、Land/Discard/Ship、Telegram 启动/轮询/更新/转发/watch、渲染层未捕获异常）。条目按 `area + error name + code + message` 生成指纹；同一 Scope 内已存在 `open` 或 `promoted` 的同指纹条目时只增加 `occurrences`、更新 `last_seen_at` 和更高的 severity，不重复插入。错误正文会脱敏 Telegram bot token、`Bearer`、`sk-*`、`api_key` / `token` / `secret` / `password` 赋值。
- **不阻塞主流程**：自动捕获与渲染层上报都是 best-effort；数据库写入失败只回到 `console.error`，绝不让业务操作失败。进程级 `uncaughtExceptionMonitor` 在 Node 默认崩溃路径之前尝试写入，数据库不可达时仍保留原有崩溃行为。
- **提升为 Task**：`promote` 在同一个事务里创建（或复用）一条带 `dedupe_key = improvement:<id>` 的待办 Task，并写回 `task_id` 和 `status = promoted`。重复点击不会创建第二条 Task。提升动作写入 `improvement.promoted` Event；状态变更本身以表内 `status` + `updated_at` 为准。
- **UI**：左侧一级导航增加 Log，默认显示 `active`（open + promoted），支持按状态、kind、Scope 过滤；行内可展开详情并执行 Promote / Resolve / Dismiss / Reopen。侧栏 badge 只显示 `open` 数量。新条目默认写入当前 Scope。
- **边界**：改进日志不替代 `service.log` 的原始调试输出，不自动生成 Memory，不进入每次 Prompt；它也不承诺审计级的 append-only（状态可变）。Event 表保持业务事实与审计职责。

## 后果

- 自动错误会形成可浏览、可计数的待办，而不再只存在于一次终端会话里；持续故障会显示为一条 `×N` 的记录。
- 指纹只包含错误语义，不包含堆栈位置，因此同一版本内稳定，但不同原因可能共用一条记录；需要时展开详情区分，后续可再引入更细的指纹。
- Log 视图默认跨 Scope，避免在项目会话中看不到 Global 的服务异常；每条记录显示 Scope badge。
- 新增协议命令与 `improvements` 事件，`SERVICE_PROTOCOL` 从 2 升到 3。表由 `ImprovementStore` 自己创建，不改变 `DATABASE_VERSION`；旧服务忽略该表，新客户端不会连接旧协议服务。
- 没有新增日志轮转或外部遥测；`service.log` 的体量与轮转仍是独立问题。

## 测试

`tests/improvements.test.ts` 覆盖 Scope 过滤、列表不返回正文、指纹去重与 occurrence、severity 升级、脱敏、resolve 后复发新建、状态迁移、Task 提升幂等，以及 `log_improvement` 的工具重放与未知 Scope 拒绝。`tests/architecture.test.ts` 覆盖新命令的参数校验，`tests/state.test.ts` 覆盖 renderer API 形状。
