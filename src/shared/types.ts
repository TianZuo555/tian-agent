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
  /** Set while the conversation is folded away into the sidebar's archive. */
  archivedAt: string | null;
  /** 'manager' when bound to a project via channel 'manager'; else 'chief'. */
  role: 'chief' | 'manager';
}

/** D5: execution state and result (`outcome`) are recorded separately. */
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
  /** 'manager' when the task was delegated to the project's manager; NULL = whoever. */
  assignee: 'manager' | null;
  /** Chief conversation the manager reports to for this task; delegated tasks only. */
  reportTo: string | null;
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

/** A durable improvement observation: a bug, friction, idea, or win. */
export type ImprovementKind = 'issue' | 'friction' | 'idea' | 'win';
export type ImprovementStatus = 'open' | 'promoted' | 'resolved' | 'dismissed';
export type ImprovementSource = 'user' | 'chief' | 'system';
export type ImprovementSeverity = 'low' | 'medium' | 'high';

/** List rows omit the detail body; fetch it with `getImprovement`. */
export interface ImprovementSummary {
  id: string;
  scopeId: string;
  kind: ImprovementKind;
  status: ImprovementStatus;
  severity: ImprovementSeverity;
  summary: string;
  source: ImprovementSource;
  area: string | null;
  /** Stable key for automatic capture; repeated failures fold into one row. */
  fingerprint: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  taskId: number | null;
  conversationId: string | null;
  runId: string | null;
  eventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImprovementItem extends ImprovementSummary {
  /** Markdown-ish free text: reproduction, stack, evidence. */
  detail: string;
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
  scopeId: string;
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

export interface RunInjection {
  id: string;
  name: string;
  version: number;
}

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
  /** Approved skill versions injected into the worker prompt at dispatch (PRD §6.2). */
  injectedSkills?: RunInjection[] | null;
  /** Per-run model pin (a magpie model id); absent = the app-wide model. */
  model?: string | null;
  /** Per-run thinking level pin (a pi level name); absent = the model's default. */
  thinkingLevel?: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type MemoryStatus = 'active' | 'candidate' | 'superseded' | 'deleted';

/** Experience ≠ Verified Skill: only the user moves a candidate to approved. */
export type SkillStatus = 'candidate' | 'approved' | 'retired' | 'superseded';
export type SkillVerification = 'unverified' | 'verified' | 'failed';

export interface SkillItem {
  id: string;
  scopeId: string;
  name: string;
  description: string;
  /** Markdown procedure the worker is expected to follow. */
  body: string;
  version: number;
  status: SkillStatus;
  verification: SkillVerification;
  /** Run attempts this version was extracted from or loaded by, e.g. `run:<id>:attempt:1`. */
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  seq: number;
  content: string;
  kind: string;
  status: MemoryStatus;
  trustLevel: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number | null;
  /** Explicitly selected into the Core Memory view. */
  core: boolean;
  supersededBy: string | null;
  /** For a candidate: the active seq it will replace when promoted. */
  supersedes: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of a user revision, so the UI can report Core effects. */
export interface MemoryRevisionResult {
  seq: number;
  supersededSeq: number;
  changed: boolean;
  evidenceAdded: boolean;
  /** True when the correction could not stay in Core and was saved outside. */
  coreDropped: boolean;
}

/** Rendered Core Memory usage, including metadata and the usage footer. */
export interface MemoryCoreUsage {
  budget: number;
  tokens: number;
  selected: number;
  active: number;
}

export interface MemoryDump {
  scopeId: string;
  items: MemoryItem[];
  core: MemoryCoreUsage;
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
  improvements: ImprovementSummary[];
  runs: RunInfo[];
  inbox: string;
  memory: string;
  skills: SkillItem[];
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
