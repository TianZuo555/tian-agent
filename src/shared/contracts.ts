import { Type, type TSchema } from 'typebox';
import { Check } from 'typebox/value';
import type {
  AppEvents,
  ConversationInfo,
  InboxItem,
  MemoryDump,
  ProjectPatch,
  RunInfo,
  ScopeInfo,
  SettingsInfo,
  TaskItem,
  SessionBinding,
  ServiceInfo,
} from './types';

type Command<A extends unknown[], R> = { args: A; result: R };
export interface Commands {
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
  memoryDump: Command<[scopeId: string], MemoryDump>;
  inboxList: Command<[scopeId: string], InboxItem[]>;
  runList: Command<[scopeId: string | null], RunInfo[]>;
  runReport: Command<[id: string], string>;
  runDiff: Command<[id: string], string>;
  followUpRun: Command<[id: string, prompt: string], RunInfo>;
  landRun: Command<[id: string], string>;
  discardRun: Command<[id: string], void>;
  shipRun: Command<[id: string], string>;
  getSettings: Command<[], SettingsInfo>;
  setModel: Command<[model: SettingsInfo['model']], void>;
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

export const commandArgs = {
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
  memoryDump: Type.Tuple([id]),
  inboxList: Type.Tuple([id]),
  runList: Type.Tuple([nullableId]),
  runReport: Type.Tuple([id]),
  runDiff: Type.Tuple([id]),
  followUpRun: Type.Tuple([id, text]),
  landRun: Type.Tuple([id]),
  discardRun: Type.Tuple([id]),
  shipRun: Type.Tuple([id]),
  getSettings: Type.Tuple([]),
  setModel: Type.Tuple([
    Type.Object(
      {
        provider: Type.Union([
          Type.Literal('anthropic'),
          Type.Literal('openai'),
          Type.Literal('deepseek'),
        ]),
        modelId: id,
      },
      { additionalProperties: false },
    ),
  ]),
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

export interface TianApi extends CommandApi {
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
