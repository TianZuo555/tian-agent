import type { MessageRow } from './messages';

export interface ScopeInfo {
  id: string;
  kind: 'global' | 'project';
  name: string;
  rootPath: string;
  settings?: ProjectSettings | null;
}

export interface ProjectSettings {
  autoLand: boolean;
  allowInPlace: boolean;
  agentKind: 'durable-worker';
  runTimeoutMin: number;
  baseBranch: string;
  promptPreamble: string;
}

export type ProjectPatch = Partial<
  ProjectSettings & { name: string; rootPath: string }
>;

export interface SessionBinding {
  channel: string;
  externalId: string;
  scopeId: string;
}

export interface ServiceInfo {
  protocolVersion: number;
  pid: number;
  startedAt: string;
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

export type RunStatus =
  | 'queued'
  | 'running'
  | 'collecting'
  | 'done'
  | 'failed'
  | 'interrupted';
export type ReviewStatus =
  | 'pending'
  | 'landing'
  | 'landed'
  | 'shipping'
  | 'shipped'
  | 'discarding'
  | 'discarded';

export interface RunInfo {
  id: string;
  projectId: string;
  conversationId: string | null;
  agentKind: string;
  prompt: string;
  rootPath: string;
  baseBranch: string;
  executionMode: 'worktree' | 'in-place';
  worktreePath: string | null;
  branch: string | null;
  status: RunStatus;
  reviewStatus: ReviewStatus;
  attempt: number;
  error: string | null;
  prUrl: string | null;
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

export interface UsageDay {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  messages: number;
}

export interface UsageStats {
  days: UsageDay[];
}

export interface ChatSnapshot {
  rows: MessageRow[];
  busy: boolean;
}

export interface ViewPayload {
  conversationId: string;
  view: ChatSnapshot;
}

export interface AppEvents {
  view: ViewPayload;
  conversations: ConversationInfo[];
  tasks: TaskItem[];
  runs: RunInfo[];
  inbox: string;
  memory: string;
  scopes: ScopeInfo[];
  settings: SettingsInfo;
  runtime: { status: 'starting' | 'ready' | 'failed'; error?: string };
}

export type Emit = <K extends keyof AppEvents>(
  channel: K,
  payload: AppEvents[K],
  clientId?: number,
) => void;
