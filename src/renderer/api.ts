import type {
  ConversationInfo,
  InboxItem,
  MemoryDump,
  RunInfo,
  ScopeInfo,
  SettingsInfo,
  TaskItem,
  ViewPayload,
} from '../shared/types';

interface TianApi {
  listScopes(): Promise<ScopeInfo[]>;
  addProject(name: string, rootPath: string): Promise<ScopeInfo[]>;
  updateProject(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<ScopeInfo[]>;
  removeProject(id: string): Promise<ScopeInfo[]>;
  pickDir(): Promise<string | null>;

  listConversations(): Promise<ConversationInfo[]>;
  createConversation(scopeId: string): Promise<ConversationInfo>;
  submit(
    conversationId: string,
    text: string,
  ): Promise<{ submissionId: string }>;
  abort(conversationId: string): Promise<void>;
  watch(conversationId: string): Promise<void>;
  unwatch(conversationId: string): Promise<void>;

  listTasks(scopeId: string | null): Promise<TaskItem[]>;
  addTask(scopeId: string, title: string, due: string | null): Promise<number>;
  doneTask(id: number, done: boolean): Promise<void>;
  memoryDump(scopeId: string): Promise<MemoryDump>;
  inboxList(scopeId: string): Promise<InboxItem[]>;
  runList(scopeId: string | null): Promise<RunInfo[]>;
  runReport(id: string): Promise<string>;
  runDiff(id: string): Promise<string>;
  followUpRun(id: string, prompt: string): Promise<RunInfo>;
  landRun(id: string): Promise<string>;
  discardRun(id: string): Promise<void>;
  shipRun(id: string): Promise<string>;

  getSettings(): Promise<SettingsInfo>;
  setModel(model: { provider: string; modelId: string }): Promise<void>;

  onView(cb: (payload: ViewPayload) => void): () => void;
  onConversations(cb: (payload: ConversationInfo[]) => void): () => void;
  onTasks(cb: (payload: TaskItem[]) => void): () => void;
  onRuns(cb: (payload: RunInfo[]) => void): () => void;
  onInbox(cb: (payload: string) => void): () => void;
}

declare global {
  interface Window {
    tian: TianApi;
  }
}

export const tian: TianApi = window.tian;
