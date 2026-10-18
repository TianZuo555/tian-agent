# Tian Agent

一个总管、按项目划分的 scope，以及在 worktree 中执行任务的无头工兵。总管与工兵之间有双向消息通道：工兵可以在执行中向总管提问并等待答复，总管也可以中途下达指令。总管运行在独立的本机常驻 Node 服务中；Electron App 是它的桌面客户端。

当前已实现聊天、项目注册、记忆、任务、Inbox、Run 派发与验收、总管与工兵的双向消息（agent-to-agent），以及多渠道独立 Session 的后端接口。

## 开发与验证

```sh
pnpm install
pnpm service:install
pnpm start
pnpm typecheck
pnpm lint
pnpm test
pnpm package
pnpm test:runtime
pnpm test:launchd
```

- `pnpm test`：临时数据库、真实临时 Git 仓库和可控工兵；覆盖权限、记忆、Inbox、Run 状态、前端同步和多客户端服务。不调用模型。
- `pnpm test:runtime`：验证打包后的服务产物可以离开 checkout、通过普通 Node 运行，并连接 sandbox preload 和真实 renderer；退出 Electron 后服务继续运行。不使用用户数据或模型。
- `pnpm test:launchd`：安装独立测试 LaunchAgent，强制结束其进程，验证系统自动重启、持久化恢复和客户端重连，随后删除测试服务。
- `scripts/e2e-dispatch.mts`：需要模型凭据的手工集成检查，会执行真实工兵任务。

## 本机常驻服务

要求 Node.js 24 或更新版本。首次安装或更新后端时运行 `pnpm service:install`。安装器将完整构建产物复制到应用数据目录中的独立 release，LaunchAgent 不依赖开发 checkout、终端或 Electron 进程存活。

| 操作                 | 命令                                          |
| -------------------- | --------------------------------------------- |
| 安装／更新并启动     | `pnpm service:install`                        |
| 查看状态与 PID       | `pnpm service:status`                         |
| 启动／停止           | `pnpm service:start` / `pnpm service:stop`    |
| 重启                 | `pnpm service:restart`                        |
| 移除自启动，保留数据 | `pnpm service:uninstall`                      |
| 前台调试             | `pnpm build:service`，然后 `pnpm service:run` |

默认位置：

- 应用数据：`~/Library/Application Support/Tian Agent/`，复用已有数据库和 Memory。
- LaunchAgent：`~/Library/LaunchAgents/dev.tian.agent.plist`。
- 服务产物：`<dataDir>/service/releases/<hash>/`。
- 日志：`<dataDir>/service/logs/service.log`。
- 连接：`<dataDir>/agent.sock`，Unix socket 权限为 `0600`，数据目录为 `0700`。

使用 `TIAN_AGENT_DATA_DIR` 或 CLI 的 `--data-dir` 指定其他数据目录，`TIAN_AGENT_SOCKET_PATH` 可指定 socket 路径；App 与服务必须使用相同配置。存储和 socket 都有独占锁。旧版 App 仍占用数据库时，新服务会拒绝打开存储，需要先退出旧版 App。

LaunchAgent 保存安装时 Node 的绝对路径与 PATH。更换或删除该 Node 安装后需要重新安装服务。环境变量密钥可以写入 `<dataDir>/service.env`，文件权限应为 `0600`，然后重启服务；已有 Pi API key 配置仍可使用。安装器不将模型密钥写入 plist。

服务登录时自动启动，崩溃后由 launchd 重启。App 启动时会启动已安装的服务并连接它；退出 App 只断开连接，任务与工兵继续运行。系统休眠或关机期间无法执行任务，登录后恢复。

## 渠道与独立 Session

所有入口共享一个后端及 scope 记忆。`openSession({channel, externalId, scopeId})` 为渠道会话查找或创建稳定的内部 conversation。不同渠道、外部会话或 scope 得到不同 conversation；绑定持久化，重启后仍可复用。

例如 App 与 Telegram 都绑定 `global`，拥有独立聊天上下文，但每次请求加载同一份全局 Memory。仅存在于聊天记录、没有沉淀为 Memory 的内容不会自动进入其他 Session。外部输入可以向 `submit` 提供稳定的 `requestId`，由 Durable 去重。

当前提供多渠道 Session 接口，尚未接入 Telegram Bot 的收发与账号授权。后续 adapter 负责外部身份、收发和会话映射，复用现有工具及记忆。

## 进程与模块

- **Renderer**：React + Tailwind + coss，维护展示状态与订阅，拒绝过时响应。聊天使用应用自己的 `ChatSnapshot`。
- **Preload**：通过 `contextBridge` 暴露共享类型的命令和可取消订阅；保持 sandbox、context isolation，关闭 Node integration。
- **Main**：管理窗口、目录选择和 IPC 转发，通过 Unix socket 连接常驻服务；不打开数据库。
- **常驻服务**：唯一持有应用数据库和 Pi storage，执行模型、工具、Inbox、通知和 Run。客户端重连后重新获取快照及订阅。

| 模块                  | 职责                                              |
| --------------------- | ------------------------------------------------- |
| `service/server.ts`   | 服务生命周期、独占锁、Unix socket RPC、客户端隔离 |
| `service/client.ts`   | 请求、事件、自动重连；关闭客户端不停止服务        |
| `service/launchd.ts`  | 安装、启动、停止及移除 LaunchAgent                |
| `shared/contracts.ts` | IPC / socket 参数 schema、返回类型和消息合约      |
| `shared/messages.ts`  | Pi transcript 转换为聊天快照                      |
| `worker/service.ts`   | 应用组装、项目、总管会话、渠道绑定、Inbox 与通知  |
| `worker/commands.ts`  | 各 transport 共用的业务命令                       |
| `worker/agents.ts`    | Pi API 适配和总管／工兵能力配置                   |
| `worker/worker-tools.ts` | 工兵消息工具：ask_chief、tell_chief、check_msgs |
| `worker/runs.ts`      | Run 状态、attempt、收集、恢复及验收               |
| `worker/data.ts`      | task、memory、Inbox 操作和更新事件                |
| `worker/db.ts`        | 业务数据、渠道绑定、通知 outbox、幂等记录         |
| `worker/scopes.ts`    | scope 目录、notes 和 Inbox 文件导入               |
| `worker/memory.ts`    | 文件记忆与摘要树                                  |
| `worker/dispatch.ts`  | worktree、commit、diff、merge 和 PR 命令          |

总管和工兵共用常驻服务内的 Harness 与 Pi storage，各自显式选择 extension。工兵当前是 Durable 会话，生命周期与桌面客户端独立。

## 权限与 scope

总管只启用 chief extension：task、memory、notes、Inbox、dispatch 和 Run 查询，以及 Run 消息（`send_run_msg` / `list_run_msgs`），没有 `bash/read/write/edit`。读取结果使用 `read_run_report` / `read_run_diff`。启动时也会重新限制已有总管会话的 extension。

工兵启用 CodingTools 加消息 extension，默认在 Git worktree 中工作，没有总管的 memory 写入工具。工兵可在执行中用 `ask_chief` 向总管提问并阻塞等待答复，用 `tell_chief` 发送进度通知，用 `check_msgs` 接收总管指令；问题通过通知管道唤醒总管，答复与指令落在按 run 持久化的消息线程（`agent_messages` 表）里，重启不丢。指令要求仅编辑当前目录、只读共享 memory/notes；worktree 提供 Git 目录隔离，当前不提供操作系统文件访问沙箱。

Scope 分为 `global` 和手动注册的项目。会话绑定 scope，总管可通过工具跨 scope 查询。项目设置包含 `autoLand`、`allowInPlace`、`runTimeoutMin`、`baseBranch`、`promptPreamble`；当前工兵类型为 `durable-worker`。

## Memory

参考 OptMem 结构的 TypeScript 实现：

```text
<scope root>/memory/
  LOG.txt
  TREE/
    0-1.txt
    2-3.txt
    0-3.txt
```

- `LOG.txt`：追加事实，一行一条，正文最多 280 UTF-8 字节，附时间；保留原始内容。
- `TREE/<lo>-<hi>.txt`：对齐二叉区间摘要，父节点需要两个子摘要，使用原子 rename 发布。
- `note`：记住事实，返回待压缩区间。
- `nap`：总管写区间摘要；并发压缩不覆盖已存在的节点。
- `recall`：对原始日志逐字正则搜索。
- `zoom`：展开摘要的两个子区间。
- 每次请求注入全局与当前项目记忆，重新提示未完成的压缩及目标 scope。
- UI 只读，note/nap 完成后自动刷新。

项目记忆位于 `<project root>/memory/`；全局记忆位于 `<dataDir>/scopes/global/memory/`。较长内容存入 `<scope root>/notes/` 的 Markdown 文档。

记什么、如何摘要由总管模型负责。当前没有向量索引、语义去重、自动纠错或独立后台压缩服务。

## Run 生命周期

```text
dispatch → queued → running → collecting → done / failed
                            ↘ discard → interrupted
```

执行与验收状态分别记录。验收状态包括 `pending / landing / landed / shipping / shipped / discarding / discarded`。

- Git 项目必须成功创建 worktree；隔离失败终止派发并保留记录。
- 非 Git 项目默认拒绝，明确开启 `allowInPlace` 后才可修改原目录。
- Run 保存派发时的目录、base branch、执行模式及截止时间。
- follow-up 每轮有独立 attempt、输入、结果和报告，复用工兵会话与 worktree。
- 派发用稳定操作 ID，各轮输入用稳定 `requestId`。
- 成功依据 Durable submission 结果；空闲不代表成功，Git 提交失败会进入失败状态。
- 同一 Run 的状态转换与验收串行。discard 先停止工兵，collector 不覆盖其结果。
- land 合入保存的 base branch，要求主 checkout 位于该分支且无已跟踪文件的未提交修改；land 后不能 follow-up。
- ship 推送分支，再查询或创建 PR，重复请求复用 PR URL。
- 已开始的 land/ship/discard 先入库，启动时继续或核对。

## Agent 消息（总管 ⇄ 工兵）

每个 Run 有一条持久消息线程（`agent_messages` 表），双向可达：

- 工兵 `ask_chief(question, wait_seconds?)`：提问并阻塞等待答复。问题经通知管道立即唤醒总管（不等待 Run 结束），总管用 `send_run_msg` 回复；等待窗口内无答复则指示工兵自行判断并在报告中记录。Run 被 discard 时提问立即返回并要求停止。
- 工兵 `tell_chief(text)`：发送不等待的进度通知。
- 工兵 `check_msgs`：读取总管发来的木读消息（答复之外的主动指令）。
- 总管 `send_run_msg(run, body)`：回复提问中的工兵，或对运行中的 Run 主动下达指令；`list_run_msgs(run)` 查看完整线程。

消息 ID 与通知 ID 均由调用派生，Durable 重放不产生重复消息；已读状态持久化。工兵被指示优先自行决策，只在破坏性操作、缺失凭据或根本性歧义时提问。

报告从 `TIAN_REPORT.md` 收集到 `<project root>/.tian/runs/`，每轮独立保留，报告不进入代码提交。

## 持久化、恢复与通知

- `tian.db`：项目、会话、渠道绑定、tasks、runs、attempts、Inbox 及已读状态、通知和幂等记录。
- `pi-session.sqlite`：Pi Durable 会话、任务及 transcript。
- 文件：memory、notes、Inbox 输入和报告。

只有常驻服务写数据库，前端不是权威来源。服务收到 SIGTERM 后有序关闭；下次启动恢复会话、collector 和原截止时间。恢复遵循工具自己的 replay 策略，不保证任意外部操作恰好一次。

Run 结果与完成通知在同一个业务数据库事务中记录。通知用稳定 `requestId` 提交给总管，再标记 delivered；崩溃后可重投并由 Durable 去重。总管忙时进入 follow-up 队列。两个数据库通过操作 ID 与启动核对衔接，没有跨库原子事务。

## Inbox

外部参与者向 `<scope root>/.tian/inbox/*.md` 发布：

```md
---
id: external-message-123
from: external-agent
to: chief
ts: 2026-01-01T00:00:00Z
thread: optional-thread
---

消息正文
```

先写非 `.md` 临时文件，再 rename 发布。服务按 `(scopeId, messageId)` 导入 SQLite，逐条记已读。`fs.watch`、启动扫描与定期扫描共同处理遗漏。外部消息生成持久化通知；总管自身和 Run 完成消息不重复唤醒。

## 后续

当前使用 Pi API key 或环境变量接入 Anthropic、OpenAI、DeepSeek。Keychain、Telegram adapter、远程服务、本机／云端协议、更多工兵类型、定时简报、自动更新、签名与公证仍待实现。

参考：[Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)、[OptMem](https://github.com/VictorTaelin/OptMem)、[launchd](https://www.launchd.info/)、[coss](https://coss.com/ui)。
