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
  serviceVersion: string;
  databaseVersion: number;
  releaseId: string;
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

/** ADR 0005: execution state and result (`outcome`) are recorded separately. */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'cancelled';
export type TaskOutcome = 'achieved' | 'not_achieved' | 'no_change';
export type TaskOwner = 'user' | 'agent';
export type TaskTrigger = 'manual' | 'schedule' | 'event';

export interface TaskItem {
  id: number;
  scopeId: string;
  title: string;
  status: TaskStatus;
  due: string | null;
  createdAt: string;
  doneAt: string | null;
  /** Set when the task advances a goal; plain to-dos have none. */
  goalId: string | null;
  owner: TaskOwner;
  outcome: TaskOutcome | null;
  summary: string | null;
  trigger: TaskTrigger;
  triggerRef: string | null;
  /** Unique creation key (e.g. `sched:<id>:<fireAt>`); restarts never duplicate a task. */
  dedupeKey: string | null;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  updatedAt: string;
}

export type GoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'cancelled';

export interface ScheduleItem {
  id: string;
  goalId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextFireAt: string | null;
  lastFiredAt: string | null;
}

export interface GoalItem {
  id: string;
  scopeId: string;
  objective: string;
  successCriteria: string;
  constraints: string;
  status: GoalStatus;
  currentState: string;
  nextAction: string;
  lastExecution: string | null;
  /** The goal's dedicated chief conversation (channel binding `goal`). */
  conversationId: string | null;
  maxRunsPerDay: number;
  schedules: ScheduleItem[];
  createdAt: string;
  updatedAt: string;
}

export interface NoticeItem {
  id: number;
  goalId: string;
  scopeId: string;
  fingerprint: string;
  text: string;
  createdAt: string;
  deliveredAt: string | null;
}

/** Fields the UI may edit on a goal; state fields belong to the chief. */
export type GoalPatch = Partial<
  Pick<
    GoalItem,
    'objective' | 'successCriteria' | 'constraints' | 'maxRunsPerDay'
  >
>;

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
  /** Code tasks record the task they execute (PRD §5.2). */
  taskId?: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export type MemoryStatus = 'active' | 'superseded' | 'deleted';

export interface MemoryItem {
  seq: number;
  content: string;
  kind: string;
  status: MemoryStatus;
  trustLevel: string;
  sourceType: string;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryNodeInfo {
  lo: number;
  hi: number;
  summary: string;
  stale: boolean;
}

export interface MemoryDump {
  scopeId: string;
  items: MemoryItem[];
  nodes: MemoryNodeInfo[];
  pendingMerges: number;
}

export interface SettingsInfo {
  model: { provider: string; modelId: string };
}

export interface ModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  levels: string[];
  input: ('text' | 'image')[];
  contextWindow: number;
  maxTokens: number;
}

export interface ModelCatalog {
  models: ModelInfo[];
  ok: boolean;
  baseUrl: string;
  message?: string;
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
  goals: GoalItem[];
  notices: NoticeItem[];
  runs: RunInfo[];
  inbox: string;
  memory: string;
  scopes: ScopeInfo[];
  settings: SettingsInfo;
  runtime: {
    status: 'starting' | 'ready' | 'failed' | 'disconnected';
    error?: string;
  };
}

export type Emit = <K extends keyof AppEvents>(
  channel: K,
  payload: AppEvents[K],
  clientId?: number,
) => void;
