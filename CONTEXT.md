# Tian Agent

一个长期在线的个人 Agent：用户管理目标，Agent 管理任务；会话可以结束，记忆、目标和责任不会消失。

## 参与者

**Chief（总管）**:
长期在线、与用户对话的主 Agent；负责记忆、规划目标、派发工作和汇报，自己不改代码。
_Avoid_: steward, assistant, orchestrator

**Worker（工兵）**:
在隔离 worktree 中无人值守执行一次 Run 的编码 Agent；只读共享记忆，不写记忆。
_Avoid_: sub-agent, executor

**Manager（项目管理者）**:
每个项目一个的长期 Pi 会话；Chief 把有边界的项目工作委派给它——每次委派是一条 assignee 为 Manager 的 Task，由它执行、收口并回报。Manager 管理本项目的 Task、记忆、Notes 与 Run，可再分发编码工作给 Worker；只写本项目记忆，不写 Global 记忆，Goal 仍归 Chief，自己不改代码。
_Avoid_: sub-agent, coordinator

## 范围

**Scope**:
记忆、Notes、Inbox 与会话的归属边界，只有 Global 与 Project 两种。
_Avoid_: workspace, context

**Project**:
用户手动注册的一个本地目录，对应一个 Scope。
_Avoid_: repo, workspace

## 目标与工作

**Goal（目标）**:
用户希望长期达成或维持的结果，属于一个 Scope，持续数天到数年，带完成标准、约束和唤醒条件。
_Avoid_: objective, mission, project

**Task（任务）**:
为某个 Goal、或独立于 Goal 而要完成的一件具体工作，归属用户或 Agent 之一，有自己的状态与结果；可带 assignee，把执行指派给该项目 Manager。
_Avoid_: todo, job, ticket

**Run**:
Worker 为一个代码类 Task 在隔离 worktree 中进行的一次执行，可包含多轮 Attempt。
_Avoid_: job, dispatch（dispatch 是动作，不是对象）

**Attempt**:
Run 内的一轮输入与结果；follow-up 产生新的 Attempt，复用同一 Worker 会话与 worktree。
_Avoid_: retry, round

**Review（验收）**:
用户对 Run 结果做出的 Land、Ship 或 Discard 决定，与 Run 的执行状态分开记录。
_Avoid_: acceptance, approval

**Land**:
把 Run 的分支合入其保存的 base branch 的本地 checkout。
_Avoid_: merge

**Ship**:
推送 Run 的分支并创建或复用 PR。
_Avoid_: push, deploy

**Schedule**:
按 cron 表达式唤醒某个 Goal 并生成 Task 的持久规则。
_Avoid_: timer, job, heartbeat

**Trigger**:
使 Task 产生的原因：Manual、Schedule 或外部 Event 之一。
_Avoid_: hook, wakeup

## 记忆

**Memory**:
一条跨会话保留、带来源与可信度的事实、偏好、决策或结论，单行且不超过 1000 个字符。
_Avoid_: note, fact, log line

**Core Memory**:
某 Scope 中由用户、Chief 或该项目 Manager 明确选入、在 Token 预算内渲染并注入每次会话的少量 Memory。
_Avoid_: wake, profile, system memory, 摘要树

**Select（选入）/ Deselect（移出）**:
把一条有效 Memory 放进或移出 Core Memory。移出不等于遗忘：Memory 仍有效、仍可检索。
_Avoid_: pin, unpin, promote（promote 专指候选转有效）

**Core Usage（Core 用量）**:
当前选入条目按最终渲染文本（含序号、类型、可信度与用量页脚）估算的 Token 数与预算之比。
_Avoid_: 截断, overflow log

**Supersede（取代）**:
用修订后的 Memory 替换旧 Memory；旧 Memory 保留为历史，不再进入 Core Memory，也不会被自动重新选入。
_Avoid_: overwrite, edit, update

**Provenance（来源）**:
Memory 的来源对象与可信级别：用户确认、Agent 推断或第三方数据。操作者（谁执行写入）与来源（谁陈述事实）分开记录；只有当前请求确实由真实用户轮次发起时，才可标为用户确认。
_Avoid_: origin, citation

**History**:
所有已发生的会话内容和事件的可检索记录；只有沉淀为 Memory 的内容才会自动进入其他会话。
_Avoid_: episodic memory, transcript log

**Note**:
Scope 中 `notes/` 下的 Markdown 长文档，用于放不适合单行 Memory 的内容。
_Avoid_: doc, memory

## 改进

**Improvement Log（改进日志）**:
按 Scope 归属、可 triage 的改进记录集合，包含产品问题、使用摩擦、想法与成功经验；可由 Tian、Chief 或系统写入。
_Avoid_: bug tracker、feedback inbox、event log

**Improvement Entry（改进条目）**:
改进日志中的一条记录，带 kind（issue / friction / idea / win）、状态与可选的 Run、Conversation、Task 引用；可提升为 Task。
_Avoid_: log line、event、memory

## 交互

**Conversation**:
Chief、Manager 或 Worker 的一次持久 Pi 会话；PRD 中的 "Session" 指它。
_Avoid_: session, chat, thread

**Channel Binding**:
（渠道、外部会话 ID、Scope）到一个 Conversation 的稳定映射，例如 Desktop、Telegram 或某个 Goal。
_Avoid_: session, connection

**Inbox**:
Scope 中供外部参与者投递消息的文件邮箱。
_Avoid_: mailbox, task inbox

**Task Board（任务看板）**:
集中展示待处理、运行中、待审批、失败与最近完成 Task 的界面。
_Avoid_: task inbox, schedule view, dashboard

**Notification**:
唤醒某个 Chief Conversation 的持久投递记录，按 ID 去重。
_Avoid_: alert, event, push

**Approval（审批）**:
用户对某一次具体受控操作的持久化许可或拒绝；拒绝后同一操作不得执行。
_Avoid_: permission, consent, review

**Event**:
系统中已发生、需要审计或检索的业务事实，例如 Task 状态变化、审批决定或外部通知。
_Avoid_: log, notification
