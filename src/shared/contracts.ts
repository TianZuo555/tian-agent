import { Type, type TSchema } from 'typebox';
import { Check } from 'typebox/value';
import type {
  AppEvents,
  ConversationInfo,
  GoalItem,
  GoalPatch,
  GoalStatus,
  ImprovementItem,
  ImprovementKind,
  ImprovementSeverity,
  ImprovementSummary,
  InboxItem,
  MemoryDump,
  ProjectPatch,
  RunInfo,
  ScopeInfo,
  SettingsInfo,
  ModelCatalog,
  NoticeItem,
  SkillItem,
  TaskItem,
  SessionBinding,
  ServiceInfo,
  UsageStats,
} from './types';

import type { DesktopApi, ServiceActivity } from './desktop';

type Command<A extends unknown[], R> = { args: A; result: R };
export interface Commands {
  getActivity: Command<[], ServiceActivity>;
  beginMaintenance: Command<[], ServiceActivity>;
  finishMaintenance: Command<[], void>;
  listScopes: Command<[], ScopeInfo[]>;
  addProject: Command<[name: string, rootPath: string], ScopeInfo[]>;
  updateProject: Command<[id: string, patch: ProjectPatch], ScopeInfo[]>;
  removeProject: Command<[id: string], ScopeInfo[]>;
  pickDir: Command<[], string | null>;
  listConversations: Command<[], ConversationInfo[]>;
  createConversation: Command<[scopeId: string], ConversationInfo>;
  openSession: Command<[binding: SessionBinding], ConversationInfo>;
  submit: Command<
    [id: string, text: string, requestId?: string],
    { submissionId: string }
  >;
  abort: Command<[id: string], void>;
  watch: Command<[id: string], void>;
  unwatch: Command<[id: string], void>;
  listTasks: Command<[scopeId: string | null], TaskItem[]>;
  addTask: Command<
    [scopeId: string, title: string, due: string | null],
    number
  >;
  doneTask: Command<[id: number, done: boolean], void>;
  listGoals: Command<[scopeId: string | null], GoalItem[]>;
  createGoal: Command<
    [
      scopeId: string,
      objective: string,
      successCriteria: string,
      constraints: string,
      maxRunsPerDay: number,
    ],
    GoalItem
  >;
  updateGoal: Command<[goalId: string, patch: GoalPatch], GoalItem>;
  setGoalStatus: Command<[goalId: string, status: GoalStatus], GoalItem>;
  runGoalNow: Command<[goalId: string], TaskItem>;
  addSchedule: Command<
    [goalId: string, cron: string, timezone: string | null],
    GoalItem
  >;
  removeSchedule: Command<[scheduleId: string], GoalItem>;
  listNotices: Command<[scopeId: string | null], NoticeItem[]>;
  listImprovements: Command<[scopeId: string | null], ImprovementSummary[]>;
  getImprovement: Command<[id: string], ImprovementItem>;
  addImprovement: Command<
    [
      scopeId: string,
      kind: ImprovementKind,
      summary: string,
      detail: string,
      severity: ImprovementSeverity,
    ],
    ImprovementItem
  >;
  setImprovementStatus: Command<
    [id: string, status: 'open' | 'resolved' | 'dismissed'],
    ImprovementSummary
  >;
  promoteImprovement: Command<[id: string], ImprovementSummary>;
  /** Best-effort report from the renderer; recorded as a system issue. */
  reportClientIssue: Command<[summary: string, detail: string], void>;
  memoryDump: Command<[scopeId: string], MemoryDump>;
  memoryRevise: Command<
    [scopeId: string, seq: number, text: string, reason: string],
    void
  >;
  memoryForget: Command<[scopeId: string, seq: number, reason: string], void>;
  memoryPromote: Command<[scopeId: string, seq: number], void>;
  memoryDismiss: Command<[scopeId: string, seq: number], void>;
  inboxList: Command<[scopeId: string], InboxItem[]>;
  runList: Command<[scopeId: string | null], RunInfo[]>;
  runReport: Command<[id: string], string>;
  runDiff: Command<[id: string], string>;
  followUpRun: Command<[id: string, prompt: string], RunInfo>;
  landRun: Command<[id: string], string>;
  discardRun: Command<[id: string], void>;
  shipRun: Command<[id: string], string>;
  skillList: Command<[scopeId: string | null], SkillItem[]>;
  skillHistory: Command<[scopeId: string, name: string], SkillItem[]>;
  skillApprove: Command<[skillId: string], SkillItem>;
  skillRetire: Command<[skillId: string, reason: string | null], SkillItem>;
  skillRollback: Command<[skillId: string, reason: string | null], SkillItem>;
  getSettings: Command<[], SettingsInfo>;
  setModel: Command<[model: SettingsInfo['model']], void>;
  modelCatalog: Command<[], ModelCatalog>;
  refreshModels: Command<[], ModelCatalog>;
  usageStats: Command<[scopeId: string | null], UsageStats>;
}

const id = Type.String({ minLength: 1, maxLength: 256 });
const text = Type.String({ minLength: 1, maxLength: 100_000 });
const nullableId = Type.Union([id, Type.Null()]);
const patch = Type.Partial(
  Type.Object({
    name: Type.String({ minLength: 1, maxLength: 200 }),
    rootPath: Type.String({ minLength: 1, maxLength: 4096 }),
    autoLand: Type.Boolean(),
    allowInPlace: Type.Boolean(),
    agentKind: Type.Literal('durable-worker'),
    runTimeoutMin: Type.Integer({ minimum: 1, maximum: 1440 }),
    baseBranch: Type.String({ minLength: 1, maxLength: 256 }),
    promptPreamble: Type.String({ maxLength: 100_000 }),
  }),
  { additionalProperties: false },
);

const improvementKind = Type.Union([
  Type.Literal('issue'),
  Type.Literal('friction'),
  Type.Literal('idea'),
  Type.Literal('win'),
]);
const improvementSeverity = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
]);
const improvementStatus = Type.Union([
  Type.Literal('open'),
  Type.Literal('resolved'),
  Type.Literal('dismissed'),
]);

export const commandArgs = {
  getActivity: Type.Tuple([]),
  beginMaintenance: Type.Tuple([]),
  finishMaintenance: Type.Tuple([]),
  listScopes: Type.Tuple([]),
  addProject: Type.Tuple([
    Type.String({ minLength: 1, maxLength: 200 }),
    Type.String({ minLength: 1, maxLength: 4096 }),
  ]),
  updateProject: Type.Tuple([id, patch]),
  removeProject: Type.Tuple([id]),
  pickDir: Type.Tuple([]),
  listConversations: Type.Tuple([]),
  createConversation: Type.Tuple([id]),
  openSession: Type.Tuple([
    Type.Object(
      {
        channel: Type.String({
          minLength: 1,
          maxLength: 100,
          pattern: '^[a-z][a-z0-9-]*$',
        }),
        externalId: Type.String({ minLength: 1, maxLength: 512 }),
        scopeId: id,
      },
      { additionalProperties: false },
    ),
  ]),
  submit: Type.Union([Type.Tuple([id, text]), Type.Tuple([id, text, id])]),
  abort: Type.Tuple([id]),
  watch: Type.Tuple([id]),
  unwatch: Type.Tuple([id]),
  listTasks: Type.Tuple([nullableId]),
  addTask: Type.Tuple([
    id,
    text,
    Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
  ]),
  doneTask: Type.Tuple([Type.Integer({ minimum: 1 }), Type.Boolean()]),
  listGoals: Type.Tuple([nullableId]),
  createGoal: Type.Tuple([
    id,
    Type.String({ minLength: 1, maxLength: 2_000 }),
    Type.String({ maxLength: 10_000 }),
    Type.String({ maxLength: 10_000 }),
    Type.Integer({ minimum: 1, maximum: 48 }),
  ]),
  updateGoal: Type.Tuple([
    id,
    Type.Partial(
      Type.Object({
        objective: Type.String({ minLength: 1, maxLength: 2_000 }),
        successCriteria: Type.String({ maxLength: 10_000 }),
        constraints: Type.String({ maxLength: 10_000 }),
        maxRunsPerDay: Type.Integer({ minimum: 1, maximum: 48 }),
      }),
      { additionalProperties: false },
    ),
  ]),
  setGoalStatus: Type.Tuple([
    id,
    Type.Union([
      Type.Literal('active'),
      Type.Literal('paused'),
      Type.Literal('blocked'),
      Type.Literal('completed'),
      Type.Literal('cancelled'),
    ]),
  ]),
  runGoalNow: Type.Tuple([id]),
  addSchedule: Type.Tuple([
    id,
    Type.String({ minLength: 1, maxLength: 100 }),
    Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  ]),
  removeSchedule: Type.Tuple([id]),
  listNotices: Type.Tuple([nullableId]),
  listImprovements: Type.Tuple([nullableId]),
  getImprovement: Type.Tuple([id]),
  addImprovement: Type.Tuple([
    id,
    improvementKind,
    Type.String({ minLength: 1, maxLength: 300 }),
    Type.String({ maxLength: 20_000 }),
    improvementSeverity,
  ]),
  setImprovementStatus: Type.Tuple([id, improvementStatus]),
  promoteImprovement: Type.Tuple([id]),
  reportClientIssue: Type.Tuple([
    Type.String({ minLength: 1, maxLength: 300 }),
    Type.String({ maxLength: 20_000 }),
  ]),
  memoryDump: Type.Tuple([id]),
  memoryRevise: Type.Tuple([
    id,
    Type.Integer({ minimum: 0 }),
    Type.String({ minLength: 1, maxLength: 280 }),
    Type.String({ minLength: 1, maxLength: 2_000 }),
  ]),
  memoryForget: Type.Tuple([
    id,
    Type.Integer({ minimum: 0 }),
    Type.String({ minLength: 1, maxLength: 2_000 }),
  ]),
  memoryPromote: Type.Tuple([id, Type.Integer({ minimum: 0 })]),
  memoryDismiss: Type.Tuple([id, Type.Integer({ minimum: 0 })]),
  inboxList: Type.Tuple([id]),
  runList: Type.Tuple([nullableId]),
  runReport: Type.Tuple([id]),
  runDiff: Type.Tuple([id]),
  followUpRun: Type.Tuple([id, text]),
  landRun: Type.Tuple([id]),
  discardRun: Type.Tuple([id]),
  shipRun: Type.Tuple([id]),
  skillList: Type.Tuple([nullableId]),
  skillHistory: Type.Tuple([id, Type.String({ minLength: 1, maxLength: 256 })]),
  skillApprove: Type.Tuple([id]),
  skillRetire: Type.Tuple([
    id,
    Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  ]),
  skillRollback: Type.Tuple([
    id,
    Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  ]),
  getSettings: Type.Tuple([]),
  setModel: Type.Tuple([
    Type.Object(
      {
        provider: Type.Literal('magpie'),
        modelId: id,
      },
      { additionalProperties: false },
    ),
  ]),
  modelCatalog: Type.Tuple([]),
  refreshModels: Type.Tuple([]),
  usageStats: Type.Tuple([nullableId]),
} satisfies Record<keyof Commands, TSchema>;

export type CommandName = keyof Commands;
export type Args<K extends CommandName> = Commands[K]['args'];
export type Result<K extends CommandName> = Commands[K]['result'];
export type CommandApi = {
  [K in CommandName]: (...args: Args<K>) => Promise<Result<K>>;
};
export type Handlers = {
  [K in Exclude<CommandName, 'pickDir'>]: (
    ...args: Args<K>
  ) => Result<K> | Promise<Result<K>>;
};

export interface TianApi extends CommandApi, DesktopApi {
  on<K extends keyof AppEvents>(
    channel: K,
    callback: (payload: AppEvents[K]) => void,
  ): () => void;
}

export function validateCommand(
  name: unknown,
  args: unknown,
): asserts name is CommandName {
  if (
    typeof name !== 'string' ||
    !Object.hasOwn(commandArgs, name) ||
    !Check(commandArgs[name as CommandName], args)
  ) {
    throw new Error(`Invalid command or arguments: ${String(name)}`);
  }
}

export type RuntimeRequest = {
  type: 'request';
  id: number;
  command: CommandName;
  args: unknown[];
  clientId: number;
};
export type RuntimeMessage =
  | { type: 'ready'; info: ServiceInfo }
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | {
      type: 'event';
      channel: keyof AppEvents;
      payload: unknown;
      clientId?: number;
    };
