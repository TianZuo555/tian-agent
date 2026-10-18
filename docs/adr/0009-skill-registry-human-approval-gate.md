# Skill 以人工审批为唯一注入闸门，经验提取只产候选

Skill 的生命周期是 `candidate → approved → retired / superseded`，其中 candidate → approved 这一步只能由用户执行；Agent 没有任何工具能写 skills 表。dispatch 时按名称/关键词匹配 approved 版本注入 Worker，`runs.injected_skills` 记录注入了哪些版本；提取器是可注入接口，默认实现是确定性规则。

## 背景

F09/F10 要求从 Run 轨迹中沉淀可复用流程并按任务加载（PRD §6）。产品原则「Experience ≠ Verified Skill」是硬约束：一次未经验证的成功不得变成全局规则，未批准的候选绝不能进入任何 prompt。同时 Run 管线已经稳定（隔离 worktree、幂等派发、执行与验收分离），skill 不能破坏这些性质；M4 的模型提取还在别处进行，M5 不能依赖模型调用。

## 决定

- **一表多版本**：`skills(id, scope_id, name, version, status, verification, body, source_refs, …)`，(scope_id, name, version) 唯一。同一流程的新版本批准后，旧 approved 版本置 `superseded`；版本行永不删除，历史即审计。表归 `SkillRegistry` 所有，与 `goals` 等特性表同模式（`Db.sqlite` + `Db.transaction`）。
- **审批是用户特权**：`approve` 只接受 `candidate` 状态，且只能经 IPC/UI（`skillApprove`）触发。Chief 与 Worker 没有写 skill 的工具；提取只产生候选。
- **提取器可注入**：`ExperienceExtractor.extract({ run, report, attempts, messages }) → candidates`。默认 `RuleBasedExtractor` 离线确定性：仅当 Run `done` 且报告含明确步骤证据（steps/procedure/workflow 标题段，或 ≥3 条连续列表项）才产出，失败 Run 一律不产候选。同名同文的重复提取合并 `source_refs` 而非新增版本。模型提取器后续实现同一接口即可，管线不动。
- **两层注入防御**：dispatch 时 `matchApproved`（名称整体或全部 token 匹配任务文本，短 ASCII token 加词边界）结果记入 `runs.injected_skills`；`AgentRuntime` 渲染 Worker 指令时对每个 ref **再次校验**状态为 `approved` 才输出 body。即使 run 行被错误写入，候选也进不了 prompt。
- **审查失败不伤运行**：`reviewExperience` 在 Run 收尾后调用且整体 try/catch；提取器抛异常只留日志，Run 状态与既有数据不受影响（提取写入在事务内）。
- **失败标记，人工回滚**：加载某 skill 版本的 Run 失败时，该版本 `verification = failed`（状态不变，由用户决定）；UI 一键 `rollback` 把当前 approved 版本置 `retired + failed`，并恢复最新的 superseded 版本为 approved。不做自动回滚——失败原因未必是 skill 本身。
- **注入留痕与审计**：`runs.injected_skills`（JSON 数组）回答"这次 Run 的 Worker 看到了哪些流程"；`skill.candidate / approved / retired / rollback` 事件进 `events` 表（操作者、版本、被取代者、原因）。
- **Schema 升级 v3**：新增 `runs.injected_skills` 列。`Db` 构造时若确需升级（0 < version < DATABASE_VERSION），先 `VACUUM INTO` 做一致快照，再在单事务内迁移，失败整体回滚并保留备份文件供恢复。

## 后果

- Worker 看到的 skill 永远是用户批准过的版本；prompt 注入路径可以用 `runs.injected_skills` 复盘与回放。
- 候选名称取自 Run prompt 首行的 slug，措辞不同会得到近似重复的候选；人工审批（或未来的合并工具）负责去重，匹配也停留在名称/关键词级别，语义匹配是 M5+ 的事。
- `verification` 目前只有 `unverified → failed` 两个可达值，`verified` 预留给"多次成功 + 人工确认"的后续规则；一次成功不改变验证状态。
- 升级备份文件留在数据目录（`tian.db_v<old>.backup`），由下一次同版本升级覆盖；不做自动清理。
