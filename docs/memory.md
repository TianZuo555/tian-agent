# 记忆

记忆存储在 SQLite（`tian.db`，只有常驻服务写入），带证据、确认记录、适用条件与版本；文件只是单向只读导出（[D4](decisions.md#d4--memory-以-sqlite-为唯一写入来源core-memory-改为显式选择)）：

```text
<scope root>/memory/
  MEMORY.md        每次写入提交后原子重写的只读快照（生成时间 + 有效记忆 + 是否选入 Core + 用量）
  legacy/          一次性导入后的旧 LOG.txt 与 TREE/（旧摘要树已退役，不再读取）
```

## 表结构

| 表                     | 内容                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`             | 每条记忆带 `seq`（scope 内不可变序号）、`kind`、来源、`core`（是否显式选入 Core）、`status`（candidate/active/superseded/deleted）、`conditions`（适用环境/对象/版本）、`observed_at`、`verified_at`、`valid_until`。正文单行，最多 1000 个 Unicode 字符；candidate 另有 `supersedes` 指向审核时选择取代的目标 |
| `memory_evidence`      | 多条事实证据：实际 `source_ref`、原文 `excerpt`、来源 actor、`direct`/`paraphrase`/`inference` 关系与观察时间。重复事实补证据，不靠出现次数升级可信度                                                                                                                                                          |
| `memory_confirmations` | 独立用户确认记录：`source_ref`、被确认的正文、`explicit-save`/`review`/`legacy` 方法与时间。`source: "user"` 不能代替确认                                                                                                                                                                                      |
| `memory_versions`      | 追加式版本记录（create/promote/supersede/delete/import/select/deselect/evidence，含操作者、原因与前后内容），支持审计与恢复                                                                                                                                                                                    |
| `memory_meta`          | 一次性迁移标记（初始 Core 选择、History 索引格式、证据迁移、候选驳回抑制）                                                                                                                                                                                                                                     |
| `memory_fts`           | FTS5 trigram 全文索引（中文可检索；少于 3 字符的词回退为 LIKE 子串匹配），默认只查有效记忆，`include_history` 查历史                                                                                                                                                                                           |

旧版的 `memory_nodes` 摘要树在数据库升级事务里改名为 `memory_nodes_retired`：只是保留现场，不参与任何读取，也不会在新数据库里创建。

## 归属（[D18](decisions.md#d18--记忆按角色归属总管管-global管理者管项目)）

| 角色    | 写入        | 注入的 Core                    | 按需只读                                 |
| ------- | ----------- | ------------------------------ | ---------------------------------------- |
| Chief   | 只写 Global | 只有 Global                    | 任意项目的记忆与 Notes（带 `scope`）     |
| Manager | 只写本项目  | Global + 本项目                | Global 记忆（`recall scope=global`）     |
| Worker  | 不写        | 无（读取预算化的任务相关记忆） | 本项目 `recall` / `read_history`（只读） |

- 写工具（`remember` / `revise` / `promote` / `forget` / `select` / `deselect`）没有 `scope` / `target` 参数：目标由角色固定，`#seq` 永远指向自己那份记忆，不会误改别人的条目。
- 总管在项目会话里学到的项目事实不自己记，转交该项目的管理者（`send_manager_msg` 或 `delegate` 简报）；管理者在 Tian 直连时听到与项目无关的个人信息也不写——由 Tian 直接告诉总管。
- 跨 scope 的只读结果带 `read-only` 头，标明所有者，避免模型把对方的 `#seq` 当成自己的去修订。
- 自动提取（Memory Worker）与 Memory 面板仍按 scope 工作，不受角色限制：候选落在来源会话所在的 scope，用户在面板上的操作视为 user。

## Core Memory

Core 不是"所有有效记忆的截断视图"，而是一个**明确选择**的小集合：

- 新 `remember` 默认可检索、`core=false`；需要常驻时显式 `core=true` 或稍后 `select #seq`。
- `deselect #seq` 只是移出 Core，不等于 `forget`：条目仍 active、仍可 `recall`。
- 预算默认每个 Scope 1500 tokens，按**最终渲染文本**估算（`ceil(UTF-8 字节 / 3)`），包含序号、类型、可信度、日期、来源引用、换行与 `core: N selected · X/1500 tokens` 用量页脚。`coreUsage.tokens` 等于 `wake()` 输出的估算值。
- 选入若超额会**原子拒绝**并返回当前用量与超出量；运行时不会静默裁剪、驱逐或把 Core 变成按时间截断的日志。已过 `valid_until` 的条目不能再选入 Core，已选入的到期后自动离开渲染。
- 修订优先保证纠正生效：替换文本放得下就继承原 Core 位置；放不下则新事实仍保存、旧事实离开 Core，结果明确提示需要重新选择或释放预算。
- 同一 Conversation 内使用稳定快照：只在新的用户轮次开始且记忆版本变化时刷新，避免 Prompt 前缀缓存失效；轮次内的写入通过工具返回值告知模型。

## 工具

- `remember`：新增记忆；`core` 可选。`source: "user"` 只在当前请求确实由用户轮次发起、且语句等于整轮输入（或锚定的 `记住：…` 保存请求）时才记录用户来源；只有保存请求构成确认，等于整轮输入只证明来源，条目仍是候选。未确认的工具写入一律是候选，不是 active。
- `promote`：只在当前真实用户轮次给出锚定的 `记住：<候选正文>` / `remember: <候选正文>` 保存请求时激活候选；Memory 面板审核也走同一确认记录。普通重复、模型推断与伪造 `source` 都不能晋升。
- 工具可选传 `evidence_ref` / `excerpt` 引用历史或通知的原始条目；服务校验引用存在、属于当前 scope 且片段确在原文中。历史引用只提供证据，不能授权当前用户确认。
- `revise`：取代旧记忆（新 `seq`，旧记忆保留为历史并指向新记忆）；用户纠正一律 revise，不追加矛盾行。修订不继承旧 `sourceRef`，证据指向本次纠正。只有锚定保存请求或面板审核才执行取代；未确认的修订（包括与用户原话完全相同的句子）只保存候选并保持目标有效：目标 `#seq` 不存在或已是历史条目时直接报错，不会变成无关的新事实。
- `forget`：标记删除，从不物理删除。
- `select` / `deselect`：显式管理 Core；移出不等于遗忘。二者同样以 durable `taskId:callId` 幂等，重放不会撤销用户之后的选择。
- `recall`：关键词检索。多个词按 AND 组合、非连续也命中；少于 3 字符的词（如两字中文）走子串匹配；按 FTS 相关性排序；每行带 `#seq`、类型、日期、条件与来源引用。`limit` 限制命中条数，Token 预算按**完整返回字符串**（含元数据、换行、截断标记、省略页脚，以及空查询/无命中时的 `(no matches)`）计算；预算连最小输出都放不下时明确报参数错误，而不是输出超预算内容。无命中（含空查询）在预算足够时明确返回 `(no matches)`。

## 来源（Provenance）

操作者（谁执行写入：user / chief / manager / worker）、来源（事实由谁陈述）与确认（谁审核了存储正文）分开记录；写入目标由角色决定（见上方「归属」）：

- 服务在真实用户 `submit` 时记录普通 `pi.user` 条目；Goal / Schedule / Run / Inbox 的唤醒用 `system.notification` 条目，Worker 输入用 `worker.input`。所有输入都可分页定位，不受最近 30 条限制。
- `remember` / `revise` 的 `source: "user"` 只在存储语句与**当前用户输入整体**在规范化空白后**完全相等**时确认来源（大小写、否定、标点、路径都保留）；唯一放宽是整轮输入以 `记住：` / `请记住` / `remember:` / `please remember` 锚定开头，且其后正文完全相等且不含引号。系统唤醒、Worker 输入、以及历史上以通知正文写入的 `pi.user` 条目都不算；截取、改写、翻译、概括一律降为 `agent_inferred`，工具结果说明原因并提示记录用户原话。确认与来源是两件事：等于整轮输入只证明来源，条目仍是候选，只有锚定保存请求或面板审核才写确认记录并激活；无论是否确认，`sourceRef` 都绑定当前输入 entry 便于追溯。
- 最新输入即证据：图片/空文本输入也会被绑定（`text` 为空，验证器不确认），不会回退到更早的文本轮次。
- 确认后 `sourceRef` 精确到 `conv:<conversation>#<entry>`，可直接交给 `read_history` 定位。
- Core 快照的"轮次"以任意输入 kind 为界：通知唤醒也会在下一请求刷新，而不会被旧的用户轮次缓存冻结。
- 用户在 Memory 面板的修订固定为 `user_confirmed`、来源 `ui:memory-panel`，并写入 `memory_confirmations`。
- `observed_at` 是来源发生时间，`verified_at` 是用户审核/明确保存时间；`select` / `deselect` 只改变视图，不改变任何事实时间。
- `valid_until` 只用于确实有明确有效期的记忆；写入时统一规范化为 UTC ISO（纯日期按 UTC 零点；带时间必须含 `Z` 或偏移）。过期条目不再进入默认 `recall`、Core 或下一次导出的 `MEMORY.md`，但仍可在 `include_history` 中审核。不按频率自动衰减。
- `MEMORY.md` 是**带生成时间的快照**，只在写入提交后重写；到期后若没有新的写入，旧文件可能仍含已过期条目，文件头的时间标明快照时刻。运行时读取（Core、`recall`）每次按当前时间过滤，不依赖该文件。

## 去重与幂等

- 事实身份 = 正文 + `conditions` + `valid_until`；同 Scope、规范化空白后正文相同且条件与有效期相同的写入返回原 `#seq`（大小写保留，`Foo` 与 `foo` 视为不同）。`revise` 与 `promote` 使用同一身份规则；只改条件或有效期的修订同样版本化并取代旧行，不会留下两个 active 行。
- 重复写入若带来新的证据引用或用户确认，会追加 `memory_evidence` / `memory_confirmations`，并追加一条 `evidence` 版本记录、重建导出并推进版本号；重复同一引用是幂等的。`revise` 到相同正文也走同一条补证据路径（`changed=false` 但 `evidenceAdded=true`），元数据变宽导致 Core 放不下时会移出 Core 并明确返回 `coreDropped`。
- 重复写入若同时要求 `core: true`，仍按最终渲染集合校验预算；超额整笔回滚（包括证据更新），不会先写证据再绕过预算。
- 同内容但已 superseded/deleted 的历史不会被复活：会写入新的 active 条目。
- 相似度只用于在审核界面列出相关事实，**不**用于丢弃候选或决定取代；否定、数字、版本与 `with/without` 等差异不会被词面相似度吞掉。
- `remember` / `revise` / `forget` 以 durable `taskId:callId` 作为操作 ID，重放是空操作；并发旧 revision 由事务内的状态校验拒绝（例如候选的 supersede 目标已被用户修订时，晋升会失败并提示改用 revise）。

## 候选（自动提取）

`worker/memory-worker.ts` 在常驻服务内后台运行，不占用总管对话回合。触发时机：Task 完成、会话空闲（watch 到 busy→idle，另有 5 分钟兜底 sweep）、用户纠正（`revise` / `forget` 强制触发）。按 scope 游标增量读取 History 派生索引，经 Extract → Classify → Deduplicate（只做精确正文去重与已驳回内容抑制）→ Persist 生成候选记忆。相关事实只作为审核提示，不自动设置 `supersedes`。自动触发有 30 秒最小间隔节流；服务关闭或维护时暂停。

- 候选一律为 `candidate`、trust = `agent_inferred`，绝不进入 `wake()` 渲染与只读导出；提取与入库在同一事务，提取器抛异常则整体回滚、游标不动。
- 候选可以列出相关 active 事实；只有用户在 Memory 面板选择“确认此条取代 #seq”时，promote 才在同一事务内取代该事实，并用完整的旧事实身份做乐观校验（正文/条件/有效期任一变化都失败）。普通确认与晋升（含 `promote` 工具）只把候选转为 active，候选记录上的 `supersedes` 只是审核提示，不会自动取代任何事实。promote 不自动进入 Core。
- 用户审核修订候选时，旧候选保留为 `superseded` 历史并链接新版本；新正文成为 active 候选版本。返回的 `superseded` 是旧候选，不是新版本。
- 提取到与 active 记忆完全相同的事实时不再生成候选，但把新的来源追加为该记忆的证据（不提升可信度：提取不是确认）。
- dismiss 后相同完整事实（含 scope、正文大小写、条件与有效期）不再重复提取；抑制 key 含 scope，不用全历史相似度永久压制新的纠正。
- 提取器是可注入接口 `MemoryExtractor`，默认为确定性启发式（`Intl.Segmenter` 多语言分词，中英文模式表见源码），可离线测试；接 Magpie 模型的位置已预留但未接（PRD 问题 6 未决）。

## 任务相关上下文

- Core 是按轮次稳定的显式快照；另有一条独立预算的 `<relevant_context>`，按当前输入与正在运行的 Task 词法检索本 Scope 的 Memory、Notes 与 History，默认 1200 tokens。它不会加载全量记忆，也不会跨越项目隔离。
- 检索使用共享 `planSearch` 与少量显式同义词（如 `中文`↔`Chinese`、`postgres`↔`PostgreSQL`）；这是可解释的词法检索，不是语义理解。
- Worker 得到本项目的任务相关上下文，并可用只读 `recall` 继续查询、用 `read_history` 展开原始证据；Worker 从不写记忆。
- 被取代/删除记忆的旧 transcript 证据不会经任务相关 History 重新进入默认上下文：只去掉 History 条目中承载该旧断言的句子，同一条目里其他无关的句子仍可检索；若旧断言无法在条目中定位（例如改写后的断言引用整条），则整条不返回。
- 每轮提取记录在 `memory_worker_runs`（触发原因、来源数、候选数、去重数），并写入 `events`（`memory.extracted`）。

## 位置与用户审阅

- 项目记忆在 `<project root>/memory/`，全局记忆在 `<dataDir>/scopes/global/memory/`；较长内容放 `<scope root>/notes/` 的 Markdown。
- 首次打开某 scope 时，若存在旧版 `LOG.txt`，一次性事务导入（seq = 行号，来源 legacy、可信度 agent_inferred）；导入提交后才把源文件移入 `memory/legacy/`，回滚不会消耗导入源。旧 `TREE/` 同样移入 legacy 但不再导入。此后数据库是唯一写入来源。
- 初始化（遗留导入、初始 Core 选择）在进入可失败的业务写入事务之前完成并独立提交；`Scopes` 不缓存事务内构造的 store，外层回滚后重载会从已提交状态重新初始化。
- 数据库升级时对旧数据做一次确定性 Core 选择：用户确认优先，其次 preference/decision，再次其余，按 seq 顺序逐条校验最终渲染预算；其余 active 全部保留可检索。迁移结果可在 Memory 面板与导出中看到。
- App 的 Context Pane 里有 Memory 面板：区分候选、Core 与"可检索未常驻"，显示 Core 用量，用户可直接晋升、驳回、选入/移出、修订（操作者为 user），全部历史保留在版本记录中。

记什么、选什么由总管模型与用户决定。当前没有向量索引，也没有后台 Dreaming；Notes 检索与 Memory / History 共用同一套查询计划（`worker/search.ts`：AND、大小写不敏感子串），返回有界 snippet 与 `file.md:<line>` 命中，`read_note` 可展开命中行附近的窗口。
