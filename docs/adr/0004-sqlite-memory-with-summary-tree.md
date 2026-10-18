# Memory 以 SQLite 为唯一写入来源，保留对齐二叉摘要树

Memory 从 `<scope>/memory/LOG.txt` + `TREE/` 文件迁移到 `tian.db`，增加来源、可信度、状态与版本；OptMem 式的对齐区间摘要树保留，作为 Core Memory 的压缩机制，但同样存入 SQLite。文件改为单向导出。

## 背景

PRD 要求每条记忆有来源和可信度（F05）、用户可纠正且保留历史（F01、场景 E）、所有写入可审计与恢复。追加式文本文件做不到取代与版本；在文件旁边加元数据又会出现两个写入来源。摘要树已经能在固定预算内把长期记忆压缩注入，并且已有压缩流程和 UI，没有必要换成另一套 Core Memory 选择算法。

## 决定

- 每条 Memory 有一个按 Scope 递增、不可变的 `seq`，作为摘要树的叶子位置；Summary Node 以 `(scope, lo, hi)` 存储。
- 取代（Supersede）= 写入一条新 Memory（新 `seq`）+ 旧 Memory 标记为 `superseded` 并指向新 Memory。覆盖旧 `seq` 的所有 Summary Node 标记失效；Core Memory 渲染时跳过失效节点，下探到子节点或有效的原始行，并重新排入压缩队列。
- 删除也是状态变更，不物理删除；每次写入、取代、删除都追加一条版本记录（操作者、原因、前后内容）。
- Core Memory 的预算按 Token 计算，取代按行数（现为 96 行）的上限。
- 迁移一次性导入现有 `LOG.txt`（`seq` = 行号，来源标记为 legacy、可信度为 Agent 推断）和 `TREE/` 节点。

## 后果

- Worker 目前按指令读取 `<project>/memory/` 文件。迁移后服务继续把有效 Memory 与摘要单向导出到该目录，保证 Worker 和人可以直接读；手动修改导出文件不会写回。
- Summary Node 是 Agent 写的派生内容，可信度不高于它覆盖的 Memory，不得作为高优先级指令。
- 升级器需要覆盖这次数据库版本变化和文件导入（见 README 升级事务）。
