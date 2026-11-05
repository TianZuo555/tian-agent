# Agent 角色、Provider 与工兵执行器重构（M6 TODO）

[English](../todo-agent-refactor.md) | **简体中文**

本文档跟踪 M6 重构（[prd.md](prd.md#m6--角色边界provider工兵执行器计划中)）。设计在下表链接的文档中；本文件只放工作清单。每期单独发布，并用 `mise run verify` 单独验证。测试使用 fake，不调用模型。

## 设计来源

| 主题                        | 文档                                                          |
| --------------------------- | ------------------------------------------------------------- |
| 角色与术语                  | [CONTEXT.md](CONTEXT.md)（Chief、Worker、Manager、Scope、Intent） |
| 会话与记忆边界              | [memory.md](memory.md#会话边界提案)                           |
| 派发归属                    | [agent-work.md](agent-work.md#派发归属提案)                   |
| Goal 会话移到 Global        | [agent-work.md](agent-work.md#goal)                           |
| 工兵执行器、Intent、并发    | [agent-work.md](agent-work.md#工兵执行器提案)                 |
| 项目入口路由                | [channels.md](channels.md#telegram)                           |
| Provider 与凭据             | [decisions.md](decisions.md) 的 D21                           |
| 沙箱                        | [todo-worker-sandbox.md](todo-worker-sandbox.md)              |

## 第 1 期：角色与记忆边界

本期只收紧与删除，不加功能。

- [ ] **Scope 与角色对齐。** Goal 会话移到 Global Scope（`src/worker/service.ts` 中的 `openSession({ channel: 'goal', … })`）；Goal 保留项目关联。升级事务把已有的总管会话迁出 Project Scope；transcript 保留。实施时决定：移到 Global，还是归档。提升 `DATABASE_VERSION`（[service.md](service.md)）。测试：升级后，Project Scope 中的每个会话都是管理者或工兵会话。
- [ ] **项目入口路由到管理者。** Telegram 与微信的 `/scope <项目>`、桌面端项目下的入口，都打开管理者会话。管理者的回复转发回 chat。测试：`/scope <项目>` 之后的消息进入管理者会话，回复回到 chat。
- [ ] **管理者只看 Global Core。** 去掉管理者 `recall` 的 `scope`（`src/worker/manager-tools.ts`），同步修改 prompt 的 `MEMORY` 段。测试：管理者 `recall` 不返回任何 Global 条目，`include_history=true` 时也一样。
- [ ] **总管不读项目 History。** 把总管的 `search_history` / `read_history`（`src/worker/tools-history.ts`）限制在 Global。项目 Memory 与 Notes 的只读访问保留。测试：总管搜不到项目 transcript 中的词；对项目引用调用 `read_history` 失败。
- [ ] **工兵没有记忆。** 从工兵 prompt 中去掉 `<relevant_context>` 与 notes 目录指引（`src/worker/agents.ts`）；去掉工兵的 `recall` 与 `read_history`（`src/worker/worker-tools.ts`）。测试：工兵 prompt 中没有 `<relevant_context>`；工兵工具列表中没有记忆或 history 工具。
- [ ] **只有管理者能派发。** 去掉总管的 `dispatch`（`src/worker/tools.ts`），以及总管对项目 Run 的 `send_run_msg` / `stop_run`。工兵的 `ask_chief` / `tell_chief` 改名为 `ask_manager` / `tell_manager`。契约变化时提升 `SERVICE_PROTOCOL`。测试：总管工具列表中没有 `dispatch`；工兵提问唤醒管理者。
- [ ] **文档。** 删除 memory.md（会话边界）、agent-work.md（派发归属、Goal 会话）、channels.md 中的“提案”标记与“代码缺口”段落。更新 D12 与 D18。在 PRD §10 增加边界验收场景。英文版同步。

## 第 2 期：Provider（D21）

- [ ] **凭据存储。** 在数据目录中的 0600 密钥文件之上实现 pi-ai `CredentialStore`（`read` / `list` / `modify` / `delete`），只由服务写入。测试：文件权限为 0600；`list()` 不返回密钥。
- [ ] **Provider 注册。** 服务启动时把每个已配置的 provider 注册到 Pi。Magpie 成为预置条目（`src/worker/magpie.ts`）。`MAGPIE_*` 环境变量作为兼容入口保留一个版本。
- [ ] **动态目录。** 把 Magpie 的目录发现与离线缓存推广到所有网关 provider。内置 provider 使用 pi-ai 自带目录。
- [ ] **Settings → Providers。** 增加、编辑、删除 provider。密钥只显示末尾几位。UI 文案放在 `src/renderer/i18n/en.ts` 与 `zh.ts`；页面通过 `jsx-a11y` 规则。
- [ ] **OAuth 登录。** `models.login(provider, 'oauth', { prompt, notify })`；页面展示 `auth_url` / `device_code` 事件并回答 prompt。用 fake provider 测试。
- [ ] **按角色设置模型。** 总管模型、管理者默认模型、项目级管理者模型覆盖。切换从现有会话的下一轮开始生效。
- [ ] **文档。** D21 改为已通过，D2 改为已取代；更新 decisions.md 顶部的索引表与元数据。更新 PRD 头部（技术方向）与 PRD §13 问题 6。英文版同步。

## 第 3 期：执行器抽象与 Intent（只有 Pi）

- [ ] **多执行器 `WorkerRuntime`**（`src/worker/runs.ts`）。Run 的执行器在创建时固定。Run 保存解析后的执行器、模型与思考等级。follow-up Attempt 沿用同一执行器。
- [ ] **Settings 中的 Intent。** 每个 Intent 有名称、执行器、模型、思考等级与用途说明。
- [ ] **项目默认 Intent** 取代 `projects.agent_kind`（schema 迁移）。
- [ ] **派发选择。** `dispatch` 接受 `intent`，或明确的 `runtime` + `model`（+ `thinking_level`）。两者都给报错；都不给用项目默认 Intent。明确选择必须使用已启用的执行器。管理者 `<state>` 列出 Intent 名称与用途说明。修订 D13。测试：三种情况各一个。
- [ ] **并发。** `MAX_ACTIVE_ATTEMPTS` 移到 Settings（默认 3）。增加可选的执行器上限。只因执行器满而等待的 attempt 不阻塞后面的 attempt。总管与管理者的轮次不设上限。测试：某个执行器满时的排队顺序。
- [ ] **文档。** 把工兵执行器一节中 Intent 与并发的部分改写为现状。英文版同步。

## 第 4 期：第一个外部执行器 Codex

- [ ] **适配器。** 在 Run 的 worktree 中运行 `codex exec --json`，简报作为 prompt。解析事件流供 `run_progress` 使用。把 session id 保存在 Run 上。报告取最终文本或 `TIAN_REPORT.md`。参数与事件格式按 Codex 源码核实。
- [ ] **中止。** `stop_run` 终止进程树；worktree 保留。
- [ ] **跟进。** 在新 Attempt 中执行 `codex exec resume <session>`。
- [ ] **重启续接。** 在同一 Attempt 内自动续接，带 [agent-work.md](agent-work.md#工兵执行器提案) 中的五条护栏：先做快照提交、续接 prompt 给出最后一次工具调用、每个 Attempt 最多自动续接一次、给管理者发不阻塞通知、保留原截止时间并直接占用槽位。
- [ ] **启用流程。** Settings 中检测“已安装、已登录”。登录过期时显示“需要重新登录”，而不是笼统的失败。
- [ ] **过渡安全底线。** 环境变量白名单（必须）、`--sandbox workspace-write`、按执行器的启用确认，确认文字说明该执行器能访问服务 socket 与它自己的配置。
- [ ] **用量。** 事件流报告 token 用量时记录。
- [ ] **测试**使用 fake `codex` 可执行文件：启动、进度、中止、跟进、重启续接，以及同一 Attempt 内第二次被杀后以 `interrupted` 结束。
- [ ] **文档。** 把工兵执行器一节中的外部契约改写为现状。英文版同步。

## 第 5 期：统一 Seatbelt 沙箱

目标状态，不阻塞第 1–4 期。

- [ ] 为 Pi 工兵完成 [todo-worker-sandbox.md](todo-worker-sandbox.md) 的第 0–3 阶段。
- [ ] 验证 macOS 上的嵌套 Seatbelt：Codex 运行在外层 profile 内。
- [ ] 摸清 Codex 的状态目录：会话存储可写，配置只读。
- [ ] 用共享 profile 包住外部 CLI 进程：worktree 与会话存储可写，配置只读，拒绝服务 socket，允许网络。内部关闭 CLI 自己的沙箱。
- [ ] 对已有沙箱的执行器去掉过渡期的启用警告。更新 PRD §13 问题 8。英文版同步。
