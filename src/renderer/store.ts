import { useSyncExternalStore } from 'react';
import { tian } from './api';
import type {
  ConversationInfo,
  InboxItem,
  MemoryDump,
  RunInfo,
  ScopeInfo,
  SettingsInfo,
  TaskItem,
} from '../shared/types';
import type { ConversationView } from './messages';

export type Tab = 'tasks' | 'memory' | 'inbox' | 'runs';

interface State {
  scopes: ScopeInfo[];
  conversations: ConversationInfo[];
  activeConversationId: string | null;
  activeScopeId: string;
  view: ConversationView | null;
  tasks: TaskItem[];
  memory: MemoryDump | null;
  inbox: InboxItem[];
  runs: RunInfo[];
  settings: SettingsInfo | null;
  tab: Tab;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;
}

let state: State = {
  scopes: [],
  conversations: [],
  activeConversationId: null,
  activeScopeId: 'global',
  view: null,
  tasks: [],
  memory: null,
  inbox: [],
  runs: [],
  settings: null,
  tab: 'tasks',
  settingsOpen: false,
  loading: true,
  error: null,
};

const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const getState = () => state;

export function useStore<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pick(state),
  );
}

async function refreshPanels(scopeId: string) {
  const [tasks, memory, inbox, runs] = await Promise.all([
    tian.listTasks(scopeId),
    tian.memoryDump(scopeId).catch(() => null),
    tian.inboxList(scopeId).catch(() => []),
    tian.runList(scopeId),
  ]);
  set({ tasks, memory, inbox, runs });
}

export const actions = {
  async init() {
    try {
      const [scopes, conversations, settings] = await Promise.all([
        tian.listScopes(),
        tian.listConversations(),
        tian.getSettings(),
      ]);
      set({ scopes, conversations, settings, loading: false });
      await refreshPanels('global');
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
    tian.onView(({ conversationId, view }) => {
      if (conversationId === getState().activeConversationId)
        set({ view: view as ConversationView });
    });
    tian.onConversations((conversations) => set({ conversations }));
    tian.onTasks((tasks) => {
      set({
        tasks: tasks.filter((t) => t.scopeId === getState().activeScopeId),
      });
    });
    tian.onRuns((runs) => {
      const scope = getState().activeScopeId;
      set({
        runs: runs.filter((r) => scope === 'global' || r.projectId === scope),
      });
    });
    tian.onInbox((scopeId) => {
      if (scopeId === getState().activeScopeId) void refreshPanels(scopeId);
    });
  },

  async selectScope(scopeId: string) {
    set({ activeScopeId: scopeId });
    await refreshPanels(scopeId);
  },

  async selectConversation(conversationId: string, scopeId: string) {
    const prev = getState().activeConversationId;
    if (prev && prev !== conversationId) await tian.unwatch(prev);
    set({
      activeConversationId: conversationId,
      activeScopeId: scopeId,
      view: null,
    });
    await Promise.all([tian.watch(conversationId), refreshPanels(scopeId)]);
  },

  async newConversation(scopeId: string) {
    const conv = await tian.createConversation(scopeId);
    set({ conversations: [conv, ...getState().conversations] });
    await actions.selectConversation(conv.conversationId, scopeId);
  },

  async send(text: string) {
    const id = getState().activeConversationId;
    if (!id || !text.trim()) return;
    await tian.submit(id, text.trim());
  },

  async abort() {
    const id = getState().activeConversationId;
    if (id) await tian.abort(id);
  },

  async addProject(name: string, rootPath: string) {
    const scopes = await tian.addProject(name, rootPath);
    set({ scopes });
  },

  async removeProject(id: string) {
    const scopes = await tian.removeProject(id);
    set({ scopes });
  },

  async addTask(title: string) {
    await tian.addTask(getState().activeScopeId, title, null);
    await refreshPanels(getState().activeScopeId);
  },

  async toggleTask(id: number, done: boolean) {
    await tian.doneTask(id, done);
    await refreshPanels(getState().activeScopeId);
  },

  async refreshRuns() {
    const scope = getState().activeScopeId;
    const runs = await tian.runList(scope === 'global' ? null : scope);
    set({ runs });
  },

  async followUpRun(id: string, prompt: string) {
    await tian.followUpRun(id, prompt);
    await actions.refreshRuns();
  },

  async landRun(id: string) {
    await tian.landRun(id);
    await actions.refreshRuns();
  },

  async discardRun(id: string) {
    await tian.discardRun(id);
    await actions.refreshRuns();
  },

  async shipRun(id: string) {
    return await tian.shipRun(id);
  },

  async updateProject(id: string, patch: Record<string, unknown>) {
    const scopes = await tian.updateProject(id, patch);
    set({ scopes });
  },

  setTab(tab: Tab) {
    set({ tab });
  },

  setSettingsOpen(open: boolean) {
    set({ settingsOpen: open });
  },

  async setModel(provider: string, modelId: string) {
    await tian.setModel({ provider, modelId });
    set({ settings: { model: { provider, modelId } } });
  },
};
