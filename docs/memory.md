# 记忆

记忆存储在 SQLite（`tian.db`，只有常驻服务写入），带来源、可信度与版本；文件只是单向只读导出（[D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)）：

```text
<scope root>/memory/
  MEMORY.md        每次写入提交后原子重写的只读视图（有效记忆 + 是否选入 Core + 用量）
  legacy/          一次性导入后的旧 LOG.txt 与 TREE/（旧摘要树已退役，不再读取）
```

## 表结构

| 表                | 内容                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`        | 每条记忆带 `seq`（scope 内不可变序号）、`kind`、来源、可信度、`core`（是否显式选入 Core）、`status`（candidate/active/superseded/deleted）。正文单行，最多 1000 个 Unicode 字符；candidate 另有 `supersedes` 指向被取代目标 |
| `memory_versions` | 追加式版本记录（create/promote/supersede/delete/import/select/deselect/evidence，含操作者、原因与前后内容），支持审计与恢复                                                                                                 |
| `memory_meta`     | 一次性迁移标记（初始 Core 选择、History 索引格式）                                                                                                                                                                          |
| `memory_fts`      | FTS5 trigram 全文索引（中文可检索；少于 3 字符的词回退为 LIKE 子串匹配），默认只查有效记忆，`include_history` 查历史                                                                                                        |

旧版的 `memory_nodes` 摘要树在数据库升级事务里改名为 `memory_nodes_retired`：只是保留现场，不参与任何读取，也不会在新数据库里创建。

## Core Memory

Core 不是"所有有效记忆的截断视图"，而是一个**明确选择**的小集合：

- 新 `remember` 默认可检索、`core=false`；需要常驻时显式 `core=true` 或稍后 `select #seq`。
- `deselect #seq` 只是移出 Core，不等于 `forget`：条目仍 active、仍可 `recall`。
- 预算默认每个 Scope 1500 tokens，按**最终渲染文本**估算（`ceil(UTF-8 字节 / 3)`），包含序号、类型、可信度、日期、来源引用、换行与 `core: N selected · X/1500 tokens` 用量页脚。`coreUsage.tokens` 等于 `wake()` 输出的估算值。
- 选入若超额会**原子拒绝**并返回当前用量与超出量；运行时不会静默裁剪、驱逐或把 Core 变成按时间截断的日志。
- 修订优先保证纠正生效：替换文本放得下就继承原 Core 位置；放不下则新事实仍保存、旧事实离开 Core，结果明确提示需要重新选择或释放预算。
- 同一 Conversation 内使用稳定快照：只在新的用户轮次开始且记忆版本变化时刷新，避免 Prompt 前缀缓存失效；轮次内的写入通过工具返回值告知模型。

## 工具

- `remember`：新增记忆；`core` 可选；`source: "user"` 只在当前请求确实由用户轮次发起时才确认（见下）。
- `revise`：取代旧记忆（新 `seq`，旧记忆保留为历史并指向新记忆）；用户纠正一律 revise，不追加矛盾行。修订不继承旧 `sourceRef`，证据指向本次纠正。
- `forget`：标记删除，从不物理删除。
- `select` / `deselect`：显式管理 Core；移出不等于遗忘。二者同样以 durable `taskId:callId` 幂等，重放不会撤销用户之后的选择。
- `recall`：关键词检索。多个词按 AND 组合、非连续也命中；少于 3 字符的词（如两字中文）走子串匹配；按 FTS 相关性排序；每行带 `#seq`、类型、可信度、日期与来源引用。`limit` 限制命中条数，Token 预算按**完整返回字符串**（含元数据、换行、截断标记、省略页脚，以及空查询/无命中时的 `(no matches)`）计算；预算连最小输出都放不下时明确报参数错误，而不是输出超预算内容。无命中（含空查询）在预算足够时明确返回 `(no matches)`。

## 来源（Provenance）

操作者（谁执行写入：user / chief / manager / worker）与来源（事实由谁陈述）分开记录。项目管理者的写入被锁定到其项目 scope——它可以读取 Global 记忆，但 `remember` / `revise` / `select` 等写操作只落在自己的项目里：

- 服务在真实用户 `submit` 时记录普通 `pi.user` 条目；Goal / Schedule / Run / Inbox 的唤醒用 `system.notification` 条目，Worker 输入用 `worker.input`。所有输入都可分页定位，不受最近 30 条限制。
- `remember` / `revise` 的 `source: "user"` 只在存储语句与**当前用户输入整体**在规范化空白后**完全相等**时确认（大小写、否定、标点、路径都保留）。系统唤醒、Worker 输入、以及历史上以通知正文写入的 `pi.user` 条目都不算；截取、改写、翻译、概括一律降为 `agent_inferred`，工具结果说明原因并提示记录用户原话。确认与否和 `sourceRef` 绑定是两件事：即使不确认，也会绑定当前输入 entry 便于追溯。
- 最新输入即证据：图片/空文本输入也会被绑定（`text` 为空，验证器不确认），不会回退到更早的文本轮次。
- 确认后 `sourceRef` 精确到 `conv:<conversation>#<entry>`，可直接交给 `read_history` 定位。
- Core 快照的"轮次"以任意输入 kind 为界：通知唤醒也会在下一请求刷新，而不会被旧的用户轮次缓存冻结。
- 用户在 Memory 面板的修订固定为 `user_confirmed`、来源 `ui:memory-panel`。

## 去重与幂等

- 同 Scope、规范化空白后完全相同的正文（大小写保留，`Foo` 与 `foo` 视为不同）返回原 `#seq`，不新增条目。
- 重复写入若带来新的用户确认或新的来源引用，会升级可信度/来源并追加一条 `evidence` 版本记录、重建导出并推进版本号；不会静默吞掉。`revise` 到相同正文也走同一条补证据路径（`changed=false` 但 `evidenceAdded=true`），元数据变宽导致 Core 放不下时会移出 Core 并明确返回 `coreDropped`。
- 重复写入若同时要求 `core: true`，仍按最终渲染集合校验预算；超额整笔回滚（包括证据更新），不会先写证据再绕过预算。
- 同内容但已 superseded/deleted 的历史不会被复活：会写入新的 active 条目。
- `remember` / `revise` / `forget` 以 durable `taskId:callId` 作为操作 ID，重放是空操作；并发旧 revision 由事务内的状态校验拒绝（例如候选的 supersede 目标已被用户修订时，晋升会失败并提示改用 revise）。

## 候选（自动提取）

`worker/memory-worker.ts` 在常驻服务内后台运行，不占用总管对话回合。触发时机：Task 完成、会话空闲（watch 到 busy→idle，另有 5 分钟兜底 sweep）、用户纠正（`revise` / `forget` 强制触发）。按 scope 游标增量读取 History 派生索引，经 Extract → Classify → Deduplicate（与 `memory_fts` 比对）→ Resolve Conflicts → Persist 生成候选记忆。自动触发有 30 秒最小间隔节流；服务关闭或维护时暂停。

- 候选一律为 `candidate`、trust = `agent_inferred`，绝不进入 `wake()` 渲染与只读导出；提取与入库在同一事务，提取器抛异常则整体回滚、游标不动。
- 候选与 active 记忆同 kind 且措辞高度重叠时记为取代候选（`supersedes`）；用户在 Memory 面板 promote 时同事务取代旧记忆，但**不会**自动进入 Core。
- dismiss 后同一来源不再重复提取（去重覆盖已删除记忆）。
- 提取器是可注入接口 `MemoryExtractor`，默认为确定性启发式（中英文模式表见源码），可离线测试；接 Magpie 模型的位置已预留但未接（PRD 问题 6 未决）。
- 每轮提取记录在 `memory_worker_runs`（触发原因、来源数、候选数、去重数），并写入 `events`（`memory.extracted`）。

## 位置与用户审阅

- 项目记忆在 `<project root>/memory/`，全局记忆在 `<dataDir>/scopes/global/memory/`；较长内容放 `<scope root>/notes/` 的 Markdown。
- 首次打开某 scope 时，若存在旧版 `LOG.txt`，一次性事务导入（seq = 行号，来源 legacy、可信度 agent_inferred）；导入提交后才把源文件移入 `memory/legacy/`，回滚不会消耗导入源。旧 `TREE/` 同样移入 legacy 但不再导入。此后数据库是唯一写入来源。
- 初始化（遗留导入、初始 Core 选择）在进入可失败的业务写入事务之前完成并独立提交；`Scopes` 不缓存事务内构造的 store，外层回滚后重载会从已提交状态重新初始化。
- 数据库升级时对旧数据做一次确定性 Core 选择：用户确认优先，其次 preference/decision，再次其余，按 seq 顺序逐条校验最终渲染预算；其余 active 全部保留可检索。迁移结果可在 Memory 面板与导出中看到。
- App 的 Context Pane 里有 Memory 面板：区分候选、Core 与"可检索未常驻"，显示 Core 用量，用户可直接晋升、驳回、选入/移出、修订（操作者为 user），全部历史保留在版本记录中。

记什么、选什么由总管模型与用户决定。当前没有向量索引，也没有后台 Dreaming；Notes 检索与 Memory / History 共用同一套查询计划（`worker/search.ts`：AND、大小写不敏感子串），返回有界 snippet 与 `file.md:<line>` 命中，`read_note` 可展开命中行附近的窗口。
