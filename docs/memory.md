# 记忆

记忆存储在 SQLite（`tian.db`，只有常驻服务写入），带来源、可信度与版本；文件只是单向只读导出（[ADR-0004](adr/0004-sqlite-memory-with-summary-tree.md)）：

```text
<scope root>/memory/
  MEMORY.md        每次写入后原子重写的只读视图（有效记忆 + 未失效摘要）
  legacy/          一次性导入后的旧 LOG.txt 与 TREE/
```

## 表结构

| 表                | 内容                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`        | 每条记忆带 `seq`（scope 内不可变序号，也是摘要树叶位置）、`kind`、来源、可信度、`status`（candidate/active/superseded/deleted）。正文单行，最多 280 UTF-8 字节；candidate 另有 `supersedes` 指向被取代目标 |
| `memory_versions` | 追加式版本记录（create/promote/supersede/delete/import，含操作者、原因与前后内容），支持审计与恢复                                                                                                         |
| `memory_nodes`    | 对齐二叉摘要树 `(scope, lo, hi)`；记忆被取代或删除时覆盖它的节点标记 stale，Core Memory 下探到子节点或原始行并重新排队压缩                                                                                 |
| `memory_fts`      | FTS5 trigram 全文索引（中文可检索；少于 3 字符的查询回退为 LIKE 子串匹配），默认只查有效记忆，`include_history` 查历史                                                                                     |

## Chief 工具

- `remember`：新增记忆；`source: "user"` 表示用户明确陈述（trust = user_confirmed），可选关联 goal。
- `revise`：取代旧记忆（新 `seq`，旧记忆保留为历史并指向新记忆）；用户纠正一律 revise，不追加矛盾行。
- `forget`：标记删除，从不物理删除。
- `recall` / `nap` / `zoom`：检索、压缩与下钻；对齐区间、双子节点、并发 nap 不覆盖非 stale 节点等规则不变。零有效记忆的待合并区间自动写入空标记节点，不需要模型调用。

## Core Memory

`wake` 按 Token 预算渲染：默认每 scope 1500 tokens，按 `ceil(UTF-8 字节 / 3)` 估算，超出时头尾省略并提示 recall/zoom。同一 Conversation 内使用稳定快照：只在新的用户轮次开始且记忆版本变化时刷新，避免 Prompt 前缀缓存失效；轮次内的写入通过工具返回值告知模型。

## 位置与用户审阅

- 项目记忆在 `<project root>/memory/`，全局记忆在 `<dataDir>/scopes/global/memory/`；较长内容放 `<scope root>/notes/` 的 Markdown。
- 首次打开某 scope 时，若存在旧版 `LOG.txt` / `TREE/`，一次性事务导入（seq = 行号，来源 legacy、可信度 agent_inferred）并移入 `memory/legacy/`；此后数据库是唯一写入来源。
- App 的 Context Pane 里有 Memory 面板：区分候选与有效记忆，用户可直接晋升、驳回、修订（操作者为 user），全部历史保留在版本记录中。

记什么、如何摘要由总管模型负责；候选的取舍由用户决定。当前没有向量索引，后台接管 `nap` 压缩（F04 Dreaming）仍未实现。

## 自动记忆提取（F03）

`worker/memory-worker.ts` 在常驻服务内后台运行，不占用总管对话回合。触发时机：Task 完成、会话空闲（watch 到 busy→idle，另有 5 分钟兜底 sweep）、用户纠正（`revise` / `forget` 强制触发）。按 scope 游标增量读取 History 派生索引，经 Extract → Classify → Deduplicate（与 `memory_fts` 比对）→ Resolve Conflicts → Persist 生成候选记忆。自动触发有 30 秒最小间隔节流；服务关闭或维护时暂停。

- 候选一律为 `candidate` 状态、trust = agent_inferred，绝不进入 `wake()` 渲染与只读导出；提取与入库在同一事务，提取器抛异常则整体回滚、游标不动。
- 候选与 active 记忆同 kind 且措辞高度重叠时记为取代候选（`supersedes`）；promote 时同事务取代旧记忆，矛盾不会同时留在 Core Memory。
- dismiss 后同一来源不再重复提取（去重覆盖已删除记忆）。
- 提取器是可注入接口 `MemoryExtractor`，默认为确定性启发式（中英文模式表见源码），可离线测试；接 Magpie 模型的位置已预留但未接（PRD 问题 6 未决）。
- 每轮提取记录在 `memory_worker_runs`（触发原因、来源数、候选数、去重数），并写入 `events`（`memory.extracted`）。
