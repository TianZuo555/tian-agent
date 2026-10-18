// Shared types between main, preload and renderer.

export interface ScopeInfo {
  id: string;
  kind: 'global' | 'project';
  name: string;
  rootPath: string;
  settings?: ProjectSettings | null;
}

export interface ProjectSettings {
  autoLand: boolean;
  agentKind: string;
  runTimeoutMin: number;
  baseBranch: string;
  promptPreamble: string;
}

export interface ConversationInfo {
  conversationId: string;
  scopeId: string;
  title: string | null;
  createdAt: string;
}

export interface TaskItem {
  id: number;
  scopeId: string;
  title: string;
  status: 'open' | 'done';
  due: string | null;
  createdAt: string;
  doneAt: string | null;
}

export interface InboxItem {
  id: string;
  from: string;
  to: string;
  ts: string;
  thread: string;
  body: string;
  read: boolean;
}

export interface RunInfo {
  id: string;
  projectId: string;
  conversationId: string | null;
  agentKind: string;
  prompt: string;
  worktreePath: string | null;
  branch: string | null;
  status:
    | 'queued'
    | 'running'
    | 'done'
    | 'failed'
    | 'interrupted'
    | 'discarded';
  reportPath: string | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface MemoryDump {
  lines: string[];
  pendingMerges: number;
}

export interface SettingsInfo {
  model: { provider: string; modelId: string };
}

/** One transcript entry as pushed to the renderer (structural view). */
export interface ViewPayload {
  conversationId: string;
  view: unknown; // ConversationView — entries + docs, JSON-safe
}
