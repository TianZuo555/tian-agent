import type { ProjectRow } from './db.js';

/**
 * How prompts and tool output refer to a project's manager (D18).
 *
 * Every project has exactly one manager, named when the project is added —
 * the name is required and is what Tian and the chief call it. The bound
 * conversation is materialized on first use (openManager, delegate, a chief
 * message), so naming never has to be checked against a binding.
 */
export type ManagerProject = Pick<ProjectRow, 'managerName'>;

/** Tian's name for the manager. */
export function managerName(project: ManagerProject): string {
  return project.managerName;
}

/** ` — manager: 阿七`, appended after a project in the chief's state and list_scopes. */
export function managerClause(project: ManagerProject): string {
  return ` — manager: ${managerName(project)}`;
}
