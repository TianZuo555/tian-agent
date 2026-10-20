import type { Db, ProjectRow } from './db.js';

/**
 * Display and error text around a project's manager name (D14).
 *
 * `manager_name` is what Tian calls the manager; it is optional and never
 * decides whether a manager exists. The real criterion is the channel binding
 * (`Db.hasManager` / `Db.managerConversation`), which `openManager` creates.
 */
export type ManagerProject = Pick<ProjectRow, 'id' | 'name' | 'managerName'>;

/** Tian's name for the manager, trimmed; null when unnamed. */
export function managerName(project: ManagerProject): string | null {
  const name = project.managerName?.trim();
  return name ? name : null;
}

/**
 * How prompts and tool output refer to the manager. A name set for a project
 * whose manager was never opened still shows, marked (未配置), so the chief
 * sees Tian's choice without mistaking it for a delegate-able manager.
 */
export function managerLabel(
  project: ManagerProject,
  configured: boolean,
): string {
  const name = managerName(project);
  if (!configured) return name ? `${name} (未配置)` : '无';
  return name ?? '(未命名)';
}

/**
 * ` — manager: 阿七`, ` — manager: (未命名)` or ` — manager: 无` — the clause
 * appended after a project in the chief's state block and list_scopes.
 */
export function managerClause(db: Db, project: ManagerProject): string {
  return ` — manager: ${managerLabel(project, db.hasManager(project.id))}`;
}

/** The one error delegate / send_manager_msg raise for an unmanaged project. */
export function noManagerError(project: Pick<ProjectRow, 'name'>): string {
  return `project '${project.name}' has no manager configured — open its manager first (sidebar → Project manager); manager_name alone does not create one`;
}
