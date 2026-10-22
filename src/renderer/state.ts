import type { TianApi } from '../shared/contracts';
import { t } from './i18n';
import type {
  ChatSnapshot,
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
  ModelCatalog,
  NoticeItem,
  ProjectPatch,
  RunInfo,
  ScopeInfo,
  SettingsInfo,
  SkillItem,
  TaskItem,
} from '../shared/types';

/** Primary destination chosen in the left rail. */
export type Nav = 'chat' | 'goals' | 'skills' | 'inbox' | 'settings';

/**
 * The sidebar's shown/hidden choice, kept across launches the way a Mac app
 * keeps it. The store also builds under Node's test runner, which has no
 * localStorage, so reads fall back to shown.
 */
const SIDEBAR_OPEN_KEY = 'tian.sidebarOpen';
function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

export interface State {
  scopes: ScopeInfo[];
  conversations: ConversationInfo[];
  activeConversationId: string | null;
  activeScopeId: string;
  view: ChatSnapshot | null;
  tasks: TaskItem[];
  goals: GoalItem[];
  notices: NoticeItem[];
  improvements: ImprovementSummary[];
  improvementDetails: Record<string, string>;
  memory: MemoryDump | null;
  inbox: InboxItem[];
  runs: RunInfo[];
  skills: SkillItem[];
  settings: SettingsInfo | null;
  catalog: ModelCatalog | null;
  nav: Nav;
  /** The view Settings overlays, so its close control knows where to land. */
  navReturn: Nav;
  contextOpen: boolean;
  sidebarOpen: boolean;
  paletteOpen: boolean;
  loading: boolean;
  error: string | null;
  operationError: string | null;
  /** Transient Memory-panel notice, e.g. a correction dropped out of Core. */
  memoryNotice: string | null;
  runtimeStatus: 'starting' | 'ready' | 'failed' | 'disconnected';
}

/** Requests and event subscriptions are scoped to this store's lifetime. */
export function createAppStore(api: TianApi) {
  let state: State = {
    scopes: [],
    conversations: [],
    activeConversationId: null,
    activeScopeId: 'global',
    view: null,
    tasks: [],
    goals: [],
    notices: [],
    improvements: [],
    improvementDetails: {},
    memory: null,
    inbox: [],
    runs: [],
    skills: [],
    settings: null,
    catalog: null,
    nav: 'chat',
    navReturn: 'chat',
    contextOpen: true,
    sidebarOpen: readSidebarOpen(),
    paletteOpen: false,
    loading: true,
    error: null,
    operationError: null,
    memoryNotice: null,
    runtimeStatus: 'starting',
  };
  const listeners = new Set<() => void>();
  const versions: Record<string, number> = {};
  let subscriptions: (() => void)[] = [];
  let watchedId: string | null = null;
  let watchQueue = Promise.resolve();
  let lifetime = 0;
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const next = (key: string) => (versions[key] = (versions[key] ?? 0) + 1);
  const error = (reason: unknown) => set({ operationError: String(reason) });
  const safe = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (reason) {
      error(reason);
    }
  };
  async function load<
    K extends
      | 'scopes'
      | 'conversations'
      | 'settings'
      | 'catalog'
      | 'tasks'
      | 'goals'
      | 'notices'
      | 'improvements'
      | 'memory'
      | 'inbox'
      | 'runs'
      | 'skills',
  >(key: K, fetch: () => Promise<State[K]>, scopeId?: string): Promise<void> {
    const version = next(key);
    const generation = lifetime;
    const value = await fetch();
    if (
      generation === lifetime &&
      version === versions[key] &&
      (scopeId === undefined || scopeId === state.activeScopeId)
    )
      set({ [key]: value } as Partial<State>);
  }
  async function refreshPanels(scopeId = state.activeScopeId): Promise<void> {
    await Promise.all([
      // Tasks, goals, notices, and the inbox back whole-app dashboards, so
      // they always load across scopes; memory and runs stay scoped to the
      // conversation the context pane is inspecting.
      load('tasks', () => api.listTasks(null)),
      load('goals', () => api.listGoals(null)),
      load('notices', () => api.listNotices(null)),
      load('improvements', () => api.listImprovements(null)),
      load('memory', () => api.memoryDump(scopeId), scopeId),
      load('inbox', () => api.inboxList(null)),
      load(
        'runs',
        () => api.runList(scopeId === 'global' ? null : scopeId),
        scopeId,
      ),
      load('skills', () => api.skillList(null)),
    ]);
  }
  async function syncWatch(): Promise<void> {
    const generation = lifetime;
    watchQueue = watchQueue
      .catch(() => {})
      .then(async () => {
        if (generation !== lifetime) return;
        const target = state.activeConversationId;
        if (watchedId && watchedId !== target) {
          const previous = watchedId;
          watchedId = null;
          await api.unwatch(previous);
        }
        if (generation !== lifetime) return;
        if (
          target &&
          watchedId !== target &&
          target === state.activeConversationId
        ) {
          await api.watch(target);
          watchedId = target;
        }
      });
    await watchQueue;
  }
  async function refresh(): Promise<void> {
    const generation = lifetime;
    const scopeAtStart = state.activeScopeId;
    try {
      await Promise.all([
        load('scopes', () => api.listScopes()),
        load('conversations', () => api.listConversations()),
        load('settings', () => api.getSettings()),
        load('catalog', () => api.modelCatalog()),
      ]);
      if (generation !== lifetime) return;
      set({ loading: false, error: null, runtimeStatus: 'ready' });
      await Promise.all([
        scopeAtStart === state.activeScopeId
          ? refreshPanels(scopeAtStart)
          : Promise.resolve(),
        syncWatch(),
      ]);
    } catch (reason) {
      if (generation === lifetime)
        set({ loading: false, error: String(reason) });
    }
  }
  async function selectScope(scopeId: string): Promise<void> {
    const active = state.conversations.find(
      (conversation) =>
        conversation.conversationId === state.activeConversationId,
    );
    set({
      activeScopeId: scopeId,
      activeConversationId:
        active?.scopeId === scopeId ? state.activeConversationId : null,
      view: null,
      memory: null,
      runs: [],
      operationError: null,
    });
    await Promise.all([refreshPanels(scopeId), syncWatch()]);
  }
  async function selectConversation(
    id: string,
    scopeId: string,
  ): Promise<void> {
    // Picking a conversation is a request to read it, whichever view is up:
    // the rail lists conversations on every page, so selecting one from Goals
    // or Inbox has to land on Chat instead of leaving the old view in place.
    set({
      activeConversationId: id,
      activeScopeId: scopeId,
      nav: 'chat',
      navReturn: 'chat',
      view: null,
      memory: null,
      runs: [],
      operationError: null,
    });
    await Promise.all([refreshPanels(scopeId), syncWatch()]);
  }

  const actions = {
    init(): () => void {
      if (subscriptions.length) return () => {};
      lifetime++;
      subscriptions = [
        api.on('view', ({ conversationId, view }) => {
          if (conversationId === state.activeConversationId) set({ view });
        }),
        api.on('conversations', (conversations) => {
          next('conversations');
          set({ conversations });
        }),
        api.on('scopes', (scopes) => {
          next('scopes');
          set({ scopes });
        }),
        api.on('settings', (settings) => {
          next('settings');
          set({ settings });
        }),
        api.on('tasks', (tasks) => {
          next('tasks');
          set({ tasks });
        }),
        api.on('goals', (goals) => {
          next('goals');
          set({ goals });
        }),
        api.on('notices', (notices) => {
          next('notices');
          set({ notices });
        }),
        api.on('improvements', (improvements) => {
          next('improvements');
          set({ improvements });
        }),
        api.on('runs', (runs) => {
          next('runs');
          set({
            runs: runs.filter(
              (run) =>
                state.activeScopeId === 'global' ||
                run.projectId === state.activeScopeId,
            ),
          });
        }),
        api.on('memory', (scopeId) => {
          if (scopeId === state.activeScopeId)
            void safe(() =>
              load('memory', () => api.memoryDump(scopeId), scopeId),
            );
        }),
        api.on('skills', (skills) => {
          next('skills');
          set({ skills });
        }),
        api.on('inbox', () => {
          void safe(() => load('inbox', () => api.inboxList(null)));
        }),
        api.on('runtime', (runtime) => {
          set({
            runtimeStatus: runtime.status,
            operationError:
              runtime.status === 'failed'
                ? (runtime.error ?? 'Runtime unavailable')
                : null,
          });
          if (runtime.status === 'disconnected') {
            lifetime++;
            watchedId = null;
            set({
              loading: false,
              error: null,
              view: state.view ? { ...state.view, busy: false } : null,
            });
          }
          if (runtime.status === 'starting') {
            watchedId = null;
            set({ view: null });
          }
          if (runtime.status === 'ready') void refresh();
        }),
      ];
      void refresh();
      return () => {
        lifetime++;
        for (const unsubscribe of subscriptions) unsubscribe();
        subscriptions = [];
        const previous = watchedId;
        watchedId = null;
        if (previous) void api.unwatch(previous).catch(() => {});
      };
    },
    refresh,
    selectScope: (scopeId: string) => safe(() => selectScope(scopeId)),
    selectConversation: (id: string, scopeId: string) =>
      safe(() => selectConversation(id, scopeId)),
    newConversation: (scopeId: string) =>
      safe(async () => {
        const conversation = await api.createConversation(scopeId);
        next('conversations');
        set({
          conversations: [
            conversation,
            ...state.conversations.filter(
              (item) => item.conversationId !== conversation.conversationId,
            ),
          ],
        });
        await selectConversation(conversation.conversationId, scopeId);
      }),
    /** Tian's direct line into a project manager: open-or-create, upsert, select. */
    openManager: (projectId: string) =>
      safe(async () => {
        const conversation = await api.openManager(projectId);
        next('conversations');
        set({
          conversations: [
            conversation,
            ...state.conversations.filter(
              (item) => item.conversationId !== conversation.conversationId,
            ),
          ],
        });
        await selectConversation(conversation.conversationId, projectId);
      }),
    send: (text: string) =>
      safe(async () => {
        if (state.activeConversationId && text.trim())
          await api.submit(state.activeConversationId, text.trim());
      }),
    abort: () =>
      safe(async () => {
        if (state.activeConversationId)
          await api.abort(state.activeConversationId);
      }),
    archiveConversation: (id: string, archived: boolean) =>
      safe(async () => {
        await api.archiveConversation(id, archived);
      }),
    /** Register a project with its manager, then open that manager (D18). */
    addProject: (name: string, rootPath: string, managerName: string) =>
      safe(async () => {
        const scopes = await api.addProject(name, rootPath, managerName.trim());
        const project = scopes.find(
          (scope) => scope.kind === 'project' && scope.name === name.trim(),
        );
        if (project) await actions.openManager(project.id);
      }),
    removeProject: (id: string) =>
      safe(async () => {
        await api.removeProject(id);
      }),
    addTask: (title: string) =>
      safe(async () => {
        await api.addTask(state.activeScopeId, title, null);
      }),
    toggleTask: (id: number, done: boolean) =>
      safe(async () => {
        await api.doneTask(id, done);
      }),
    addImprovement: (
      kind: ImprovementKind,
      summary: string,
      detail: string,
      severity: ImprovementSeverity,
    ) =>
      safe(async () => {
        const entry = await api.addImprovement(
          state.activeScopeId,
          kind,
          summary,
          detail,
          severity,
        );
        set({
          improvementDetails: {
            ...state.improvementDetails,
            [entry.id]: entry.detail,
          },
        });
      }),
    setImprovementStatus: (
      id: string,
      status: 'open' | 'resolved' | 'dismissed',
    ) =>
      safe(async () => {
        await api.setImprovementStatus(id, status);
      }),
    promoteImprovement: (id: string) =>
      safe(async () => {
        await api.promoteImprovement(id);
      }),
    loadImprovement: (id: string) =>
      safe(async () => {
        if (state.improvementDetails[id] !== undefined) return;
        const entry: ImprovementItem = await api.getImprovement(id);
        set({
          improvementDetails: {
            ...state.improvementDetails,
            [id]: entry.detail,
          },
        });
      }),
    memoryRevise: async (seq: number, text: string, reason: string) => {
      try {
        const result = await api.memoryRevise(
          state.activeScopeId,
          seq,
          text,
          reason,
        );
        // Surface Core effects: the correction is saved, but it may live
        // outside Core when the rendered budget cannot fit it.
        set({
          memoryNotice: result.coreDropped
            ? t('memory.savedDropped', { seq: result.seq })
            : null,
        });
      } catch (reason) {
        error(reason);
      }
    },
    memoryForget: (seq: number, reason: string) =>
      safe(() => api.memoryForget(state.activeScopeId, seq, reason)),
    memoryPromote: (
      seq: number,
      replacement?: {
        seq: number;
        content: string;
        conditions?: string;
        validUntil?: string | null;
      },
    ) =>
      safe(() =>
        replacement
          ? api.memoryPromote(state.activeScopeId, seq, replacement)
          : api.memoryPromote(state.activeScopeId, seq),
      ),
    memoryDismiss: (seq: number) =>
      safe(() => api.memoryDismiss(state.activeScopeId, seq)),
    memorySelect: (seq: number) =>
      safe(() => api.memorySelect(state.activeScopeId, seq)),
    memoryDeselect: (seq: number) =>
      safe(() => api.memoryDeselect(state.activeScopeId, seq)),
    skillApprove: (id: string) => safe(() => api.skillApprove(id)),
    skillRetire: (id: string) => safe(() => api.skillRetire(id, null)),
    skillRollback: (id: string) => safe(() => api.skillRollback(id, null)),
    createGoal: (
      objective: string,
      successCriteria: string,
      constraints: string,
      maxRunsPerDay: number,
    ) =>
      safe(async () => {
        await api.createGoal(
          state.activeScopeId,
          objective,
          successCriteria,
          constraints,
          maxRunsPerDay,
        );
      }),
    updateGoal: (id: string, patch: GoalPatch) =>
      safe(async () => {
        await api.updateGoal(id, patch);
      }),
    setGoalStatus: (id: string, status: GoalStatus) =>
      safe(async () => {
        await api.setGoalStatus(id, status);
      }),
    runGoalNow: (id: string) =>
      safe(async () => {
        await api.runGoalNow(id);
      }),
    addSchedule: (goalId: string, cron: string, timezone: string | null) =>
      safe(async () => {
        await api.addSchedule(goalId, cron, timezone);
      }),
    removeSchedule: (scheduleId: string) =>
      safe(async () => {
        await api.removeSchedule(scheduleId);
      }),
    refreshRuns: () =>
      load(
        'runs',
        () =>
          api.runList(
            state.activeScopeId === 'global' ? null : state.activeScopeId,
          ),
        state.activeScopeId,
      ),
    async followUpRun(id: string, prompt: string) {
      await api.followUpRun(id, prompt);
    },
    async stopRun(id: string) {
      await api.stopRun(id);
    },
    async landRun(id: string) {
      await api.landRun(id);
    },
    async discardRun(id: string) {
      await api.discardRun(id);
    },
    async shipRun(id: string) {
      return api.shipRun(id);
    },
    async updateProject(id: string, patch: ProjectPatch) {
      await api.updateProject(id, patch);
    },
    setNav(nav: Nav) {
      set({
        nav,
        navReturn:
          nav === 'settings'
            ? state.nav === 'settings'
              ? state.navReturn
              : state.nav
            : nav,
      });
    },
    /** Open Settings, or leave it for the view it was opened from. */
    toggleSettings() {
      actions.setNav(state.nav === 'settings' ? state.navReturn : 'settings');
    },
    setContextOpen(contextOpen: boolean) {
      set({ contextOpen });
    },
    setSidebarOpen(sidebarOpen: boolean) {
      set({ sidebarOpen });
      try {
        localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? '1' : '0');
      } catch {
        /* this window only */
      }
    },
    async refreshModels() {
      const catalog = await api.refreshModels();
      set({ catalog });
      return catalog;
    },
    setPaletteOpen(paletteOpen: boolean) {
      set({ paletteOpen });
    },
    setModel: (provider: string, modelId: string) =>
      safe(() => api.setModel({ provider, modelId })),
    clearError() {
      set({ operationError: null });
    },
  };
  return {
    getState: () => state,
    actions,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
