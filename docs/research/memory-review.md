# 记忆系统调研：OpenClaw、Hermes 与 Tian Agent

调研日期：2026-10-18。本文是研究与改进建议，不替代 ADR 0004，也不表示已经决定或完成架构迁移。

## 结论

建议保留 Tian Agent 的 SQLite 单一写入来源、Global / Project Scope、来源与版本记录、History 派生索引和用户纠正能力；把 Core Memory 改为小容量、明确选择的常驻事实，让其余有效 Memory、Notes 和 History 按需检索。优先修正确性和检索缺口，再决定是否增加向量检索。

最值得删减的是**按序号递归压缩所有记忆、并要求 Chief 立即处理的摘要树流程**。它解决了长度问题，却没有直接解决哪些事实值得常驻的问题，还带来额外工具调用、重复摘要和并发失效管理。

借鉴方向：Hermes 的精简常驻记忆、容量反馈、精确去重；OpenClaw 的可追溯检索、来源约束、压缩前保存与后台整理。没有必要照搬文件存储、多种后端、整套 Dreaming 或知识图谱。

## 调研依据与范围

- 阅读两项目官方记忆文档，并检查公开源码。OpenClaw 的复杂后台功能以下述官方文档为依据，没有部署运行它；Hermes 也没有进行端到端实测。
- 查询到上游 main：OpenClaw `c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0`，Hermes `9e01b44dd23978f9ff40b7837467f3a9f1582130`。官方网页和 main 会更新，不应把旧文章的默认配置当成永久事实。
- 本项目以当前 checkout 代码为准。PRD 的 F01 / F02 / F05 及部分对象现状已经落后于实现。
- 运行现有 Memory / History 的 18 个测试，全部通过；另外用临时数据库做了五组针对性复现。未读取用户实际记忆数据库，没有真实模型调用，不能据此量化实际回答质量或模型费用。

## 三套系统对比

| 维度         | OpenClaw 默认 Memory Core                          | Hermes 内置记忆                                           | Tian Agent 当前实现                                                         |
| ------------ | -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| 权威存储     | 工作区 Markdown；SQLite 负责派生检索及部分后台状态 | `MEMORY.md`、`USER.md`；会话存在 SQLite                   | Memory 在 SQLite；Markdown 是单向导出；Notes 是独立 Markdown                |
| 常驻内容     | 精选长期事实、用户资料，按预算注入                 | 两个小容量记忆文件                                        | Global + 当前 Project 的有效 Memory / 摘要节点                              |
| 预算         | 启动注入预算，详细材料留在日记和历史               | 默认 2,200 + 1,375 字符，可配置                           | 每个 Scope 默认约 1,500 tokens，以 UTF-8 字节 / 3 估算                      |
| 预算管理     | 精选、整理、移动详细内容；超限注入会截断           | 写入超限报错，Agent 合并或移除条目后重试                  | 不论是否超预算都生成摘要任务；注入优先最大摘要，再首尾截断                  |
| 长期事实检索 | 关键词 + 向量，可加时间与重要性权重、MMR 去冗余    | 内置小文件直接常驻；更深能力可用外部 provider             | `recall`：trigram FTS / 短词 LIKE，按 seq 排序                              |
| 会话检索     | 独立会话检索；可选语义会话索引                     | `session_search`：FTS、展开、滚动、浏览，无检索时模型摘要 | `search_history` / `read_history`：消息、工具和事件，Scope / 时间筛选、引用 |
| 自动整理     | 压缩前 flush、后台 Dreaming，来源与晋升限制        | 主动 memory 工具及后台 review；原生小文件不会自动压缩     | Chief 主动写入并承担 `nap`；未发现应用层独立提取 / flush 流程               |
| 纠正         | 当前设计支持 supersession 与整理；部分写入有前镜像 | patch / remove，容量和目标匹配校验                        | supersede / soft delete / before-after 版本记录                             |
| 快照         | 当前架构文档描述符合条件的核心内容可逐轮刷新       | 会话开始冻结，后续写入到新会话才进系统快照                | 一轮内冻结；新用户轮且版本变化时刷新                                        |

这里的“文件优先”与“数据库优先”不是优劣排名。Tian Agent 有常驻服务、多渠道、多 Conversation、UI 纠正和审计需求，SQLite 很适合；没必要为了模仿别人换成可双向编辑的文件。

## OpenClaw 可以借鉴什么

### 小核心与可检索资料分开

当前文档区分 `USER.md`、精选 `MEMORY.md`、`memory/YYYY-MM-DD*.md`、会话记录和供人审阅的 `DREAMS.md`。长期资料能保存，不代表必须进入每次回答的上下文。

对本项目的启发是明确 Core Memory 的选择，而不是再加一种“日记”数据源。我们已经有 History、Event、Notes；它们足以承担详细记录和证据。

### 检索结果能回到证据

`memory_search` 找片段，`memory_get` 读取来源；混合检索兼顾改写表达与精确标识符，MMR 减少相似结果挤占名额。长期偏好与日常事件不应一律按时间衰减。

我们可先统一 Memory / Notes 的查询语义、相关性排序、预算与引用。向量检索应作为可重建的派生索引，并用中文改写、同义词与跨语言问题的评测确认收益。

### 保存与维护不抢占正常回答

压缩前 flush 给 Agent 一次保存尚未落盘信息的机会；Dreaming 把整理放到后台，并有来源、预算和冲突控制。当前 OpenClaw 已经相当复杂，值得借鉴的是职责与约束，不是整套功能数量。

本项目可以只做有游标、有预算的增量 review：用户明确要求保存或纠正时立即处理；Run 完成、Conversation 空闲、压缩前才考虑提取；失败可重试且不阻断用户回答。压缩前钩子需要先验证执行 Runtime 支持，不能假定应用已有。

### 来源需要参与行为

OpenClaw 当前文档强调 owner / agent / untrusted / system 的来源分类，并防止召回内容被再次提取、反复增加权重。

我们应让服务记录证据引用和输入来源；来源不只是 UI 标签。尤其不能把“模型选择 source=user”当成已验证的用户确认。对 Worker 产出的可复用结论，可以保留来源并由 Chief 筛选，不必照搬 OpenClaw 对某些后台会话的全面晋升限制。

## Hermes 可以借鉴什么

### 常驻预算用来选择，不要求覆盖所有历史

默认 `MEMORY.md` 2,200 字符、`USER.md` 1,375 字符；文档给出的约 800 + 500 tokens 是估算，不是对中文也成立的 tokenizer 计数。满了会返回用量与当前条目，让 Agent 在一次批处理中腾出空间并新增。

适合我们的是“让模型看到容量并做选择”。可以仍用 SQLite，只把少量用户偏好、长期约束、项目约定选入 Core；未入选的事实仍然有效、仍可检索。

### 精确去重和清晰的修改语义

Hermes 对完全相同的条目不重复添加，patch 要求唯一匹配，批处理只在最终状态检查总容量。这些规则简单且实用。

我们已有更明确的 `#seq` 和 supersede 历史链，应保留；补规范化后的精确去重与操作幂等。语义相似只能返回候选，不应凭近似匹配自动删除或合并不同事实。

### 原始会话可继续读取

Hermes 的 `session_search` 支持查找后继续滚动，返回真实消息，不需要另一个模型先摘要。当前源码也有有界截断，不能把文档“无截断”的概括理解成所有调用都无限输出；重要的是可继续定位和读取。

我们已经有对应的检索工具，主要缺口是长内容的分页展开，而不是另造一个 History 系统。

### 不照搬整个会话冻结

Hermes 冻结系统快照有利于缓存，但其文档也专门解释 Telegram 长会话需要 `/new` 才能看到更新。本项目跨渠道共享记忆，用户纠正应及时进入后续轮次；现有“同一轮稳定、下一用户轮刷新”更符合产品目标。

可增加低频更新策略或更稳定的 Core 内容，但不能以缓存为由，让纠正后的偏好数周不生效。

## 我们已经做对的部分

- `memories`、`memory_versions` 由服务统一写入；修订保留旧条目与链路。
- Global / Project 注入边界明确；Chief 可以显式跨 Scope 查询，这不是用户权限隔离系统。
- History 以 Pi transcript 为原始来源，派生索引可重建，覆盖 Chief、Worker 与业务 Event。
- History 已支持多词 AND、短词 LIKE、FTS 相关性排序、时间过滤、引用和结果预算。
- Worker 只读共享记忆，UI 支持用户纠正与遗忘。
- 新用户轮按版本刷新记忆，不要求结束长期 Conversation。

对应代码：[memory.ts](../../src/worker/memory.ts)、[history.ts](../../src/worker/history.ts)、[tools.ts](../../src/worker/tools.ts)、[tools-memory.ts](../../src/worker/tools-memory.ts)。

## 已确认的问题与优化顺序

### P0：旧摘要可以把已纠正的事实带回来

位置：`memory.ts` 的 `nextMerge()`、`revise()`、`nap()`。

复现顺序：

1. 写入“用户喝咖啡”和“项目使用 SQLite”，Conversation A 取得区间 0–1 的摘要输入。
2. 用户在另一个入口纠正为“用户喝茶”，旧节点失效，修订条目写入 #2。
3. A 根据旧输入提交“用户喝咖啡；项目使用 SQLite”。
4. `nap()` 接受这份过期摘要，Core 同时出现咖啡和茶。

当前校验只保证区间合法、子节点就绪、没有已有有效摘要，不保证提交的摘要基于当前版本。

如果短期保留摘要树，应在取得输入时返回 source revision / hash，提交时在同一事务校验，过期则拒绝。将来任何后台整理也需要相同的乐观并发控制。仅用数据库事务包住提交不足以覆盖模型生成期间的变化。

### P1：摘要树过早压缩，常驻信息量与预算脱节

位置：`memory.ts:574` 的 `wake()`，`tools-memory.ts:36` 的 `mergeNotice()`，`tools.ts` 的立即 `nap` 指令。

临时数据库复现：8 条很短的不同事实，完成所有 pending merge 后产生 7 次摘要写入；预算为 1,500 tokens 时，输出仍只有 `#0-7 ...` 一行。这个复现使用人工摘要，验证的是算法选择，不代表已经测量真实模型丢失了多少语义。

原因：`wake()` 在检查预算前先选择最大有效节点。完整二叉树的 N=2^k 个叶子需要 N−1 个内部摘要，每个摘要都限制 280 字节。即使剩余预算很多，模型也看不到原始细节；不同主题按相邻 seq 合并。

建议最终移除该机制。过渡期至少停止“所有待合并立即处理”，并在预算允许时优先显示原始重要事实。验收标准应是关键事实保留率、回答准确度、额外调用数，而不只是输出够短。

### P1：Memory 检索弱于已经实现的 History 检索

位置：`memory.ts:641` 的 `recall()`。

存入 `Project uses SQLite for durable memory` 后，`recall('SQLite')` 命中，`recall('SQLite memory')` 无结果。它把整个 query 包成一个 FTS phrase，要求连续匹配；History 已经支持词项分开匹配。

此外，Memory 结果按 seq 从旧到新排列，默认最多 100 条，没有独立 token 预算；工具没有暴露 limit。Notes 则是逐文件正则扫描、最多 100 行。

建议首先复用 History 的多词查询规则和预算机制，为 Memory 加相关性排序及明确来源；Notes 索引为带文件 / 行号的片段。检索 API 可以统一查询与结果结构，底层继续保留 Memory、Note、History 三种对象，避免把它们混成一个存储。

### P1：来源存在于表里，却没有贯穿纠正和注入

位置：`tools-memory.ts:98`、`memory.ts:468`、`wake()`、`recall()`。

- 新写入的 sourceRef 只有 `conv:<id>`，缺少 entry，不能直接交给现有 `read_history` 定位。
- Chief 调用 `revise` 固定使用 actor=chief。用户通过对话明确纠正后，新的 trustLevel 仍变为 agent_inferred；只有 UI 直接纠正使用 user。
- 修订沿用旧 sourceRef，不能指向此次纠正的证据。
- Core 和 recall 输出只有序号与正文；trustLevel、来源、时间没有随之呈现。摘要节点也没有保存可计算的可信度。

建议区分“谁执行写入”和“事实来自谁”，由服务附上证据 entry，修订引用新证据；给常驻 / 召回内容保留简洁的来源与可信标记。低可信材料不能因进入摘要就变成高优先级指令。

### P1：完全相同的记忆可以重复写入

复现：相同文本连续 remember，两条 active Memory 都会存在，并触发摘要任务。

先补同 Scope、规范化正文的精确去重；返回已有 id，并明确不同来源 / 可信度应如何补充证据，避免去重吞掉新的确认信息。同时检查操作幂等：DataService 的 Task 写入用了 `Db.once`，Memory 写入没有对应 operationId。

这不等于已经证明 Runtime 会重复执行工具；精确重复是已复现问题，重放保障是需要补齐的约束。

### P1：History 可以找到长消息，但不能继续读完整内容

位置：`history.ts:37`、`:39`、`:438`。

Tool result 在索引阶段截到 2,000 字符，tool args 截到 400 字符；`read_history` 每条再截到 1,200 字符，且没有 offset / continuation。结果是中后段有些内容根本无法搜索，有些能命中却无法通过展开读到。

Pi 原始 transcript 仍然存在，不能称为原始数据丢失。建议搜索保留有界片段，展开时按 ref 从原始 transcript 分页读取；工具返回值按 chunk 索引，或者明确声明仅索引了预览范围。不要为避免 prompt 变长而失去可继续访问证据的能力。

### P2：长度、导出与未使用字段可以简化

- **280 UTF-8 字节**：普通中文最多约 93 字。94 个“中”（282 字节）已复现被拒绝。建议分开控制单条合理长度和整体注入 token 预算，长解释继续放 Notes，不强迫每条事实像短消息一样压缩。
- **导出重复**：`exportFile()` 包含所有 active 原文与所有有效层级摘要，Worker 读整份文件时会遇到重叠内容。若去掉树，先导出一份清晰的有效条目列表；是否额外导出小 Core 视图取决于 Worker 实际使用方式。
- **confidence**：当前 Memory 路径存储该字段，但未看到赋值工具、选择、检索或决策消费它。没有校准与用途时可删除，保留离散 trustLevel。
- **goalId**：可写入，但 Core 与 recall 没有按 Goal 优先选择。要么实现用途，要么先从 Agent 工具去掉参数，避免制造不存在的能力；不应因此删掉独立的 Goal 系统。
- **旧文件迁移**：`migrateLegacy()` 可以在确认真实数据迁移完成后移到一次性升级脚本。此次没有检查用户数据库，不能直接断言可删。
- **文档漂移**：PRD 仍写 OptMem 文件存储、96 行、正则 recall、无修改删除和 History 缺失。应同步事实状态，避免再次排期已完成工作；提案涉及的树替换需另行更新 ADR，不能悄悄改写既有决定。

## 建议的目标结构

保留现有领域对象，只改变选择与维护方式：

```text
Pi transcript + Event ───────────> History 派生索引 ──> search / read
                │
                └─ 有触发、有预算的整理 ──> Memory（SQLite，有来源与版本）
                                                ├─ 少量选入 Core ──> 常驻注入
                                                └─ 其余有效事实 ──> 按需检索
Notes（Markdown 长文）──────────────────────────> 分块索引 / 按需读取
```

“选入 Core”可以先用一个简单的选择字段表示，不必新建一整套服务或第三份权威数据。用户偏好可按 kind 在 UI / prompt 分组，无需为了模仿 `USER.md` 新造存储。

选择原则：用户明确要求长期遵守的偏好与约束、当前项目长期约定优先；一次性完成记录、原始日志、临时路径保留在 History / Notes。Core 满时让 Agent 提议移出或合并；移出 Core 不等于 forget，更不等于删除原始证据。重要纠正仍在下一用户轮生效。

精简后的工具职责可以是：保留 `remember / revise / forget`，给检索提供一致的结果结构，增加可靠的单条 / 原文展开；逐步删除树专属 `nap / zoom`。是否合并工具名称不是重点，不应为了统一名称造成大范围无收益重写。

## 分阶段执行与验收

| 顺序 | 工作                                             | 完成标准                                                             |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------- |
| 1    | 修正过期摘要提交、纠正来源；补精确去重           | 过期提交拒绝；明确纠正指向新证据；重复写入不多一条                   |
| 2    | 修 Memory 多词检索、排序和预算；History 原文分页 | 非连续关键词可命中；长工具结果能读到中后段；结果可定位               |
| 3    | 建立小 Core 选择，用已有数据集比较并逐步移除树   | 核心偏好稳定可见；无每次写入后的强制摘要链；原文与版本完整保留       |
| 4    | Notes 片段检索与增量后台 review                  | 有游标、操作幂等、source revision、预算；无新内容不反复调用模型      |
| 5    | 按评测决定 embedding                             | 对改写、跨语言问题有明确增益，索引可重建，失败时保留可用的关键词检索 |

建议用 20–30 个真实但去标识化的案例评估：跨渠道保存、用户纠正、相似但不相同的事实、长期偏好被大量完成记录淹没、中文同义表达、跨项目查询、长工具结果、重启、并发修订、后台重复执行。记录命中率 / 回答正确率、旧事实误用率、常驻 tokens、附加模型调用、检索延迟。

不建议这一轮引入：独立向量数据库、多 provider 插件框架、知识图谱、完整 Light / REM / Deep 多阶段流程、每轮无条件模型 review、把全文历史又抄成一份每日 Markdown。它们都需要实际质量或使用需求来证明成本。

## 验证记录

命令：`mise exec -- pnpm exec tsx --test tests/memory.test.ts tests/history.test.ts`。

结果：18 / 18 通过。现有 5,000 条 History fixture 的检索耗时约 1.2ms；这是已构建测试数据上的本地测量，不代表含真实 transcript 同步的线上 p95。

临时脚本复现结果：

| 场景                       | 实际结果                              |
| -------------------------- | ------------------------------------- |
| 8 条事实完成所有摘要       | 7 次摘要写入，Core 仅一行根摘要       |
| 搜索非连续 `SQLite memory` | `(no matches)`                        |
| 连续写两次相同正文         | 两条 active Memory                    |
| 修订后提交旧摘要           | Core 同时出现旧“咖啡”与新“茶”         |
| Chief 代用户纠正           | agent_inferred，仍引用旧 Conversation |
| 94 个常用汉字              | 因 282 字节超过上限而拒绝             |

这些是存储与选择行为的验证，不是记忆质量的模型评测。此次只新增研究文档，没有修改运行时代码。

## 来源

- [OpenClaw Memory overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Memory architecture](https://docs.openclaw.ai/concepts/memory-architecture)
- [OpenClaw Memory search](https://docs.openclaw.ai/concepts/memory-search)
- [OpenClaw Hybrid Search 源码](https://github.com/openclaw/openclaw/blob/c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0/extensions/memory-core/src/memory/hybrid.ts)
- [OpenClaw repository](https://github.com/openclaw/openclaw/tree/c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0)
- [Hermes Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes MemoryStore 源码](https://github.com/NousResearch/hermes-agent/blob/9e01b44dd23978f9ff40b7837467f3a9f1582130/tools/memory_tool_store.py)
- [Hermes Session Search 源码](https://github.com/NousResearch/hermes-agent/blob/9e01b44dd23978f9ff40b7837467f3a9f1582130/tools/session_search_tool.py)
- [本项目 ADR 0004](../adr/0004-sqlite-memory-with-summary-tree.md)
- [本项目 ADR 0006](../adr/0006-history-derived-index-and-events.md)
