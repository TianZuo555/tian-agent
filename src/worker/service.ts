import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  EntryId,
  EntryRecord,
  Submission,
} from '@earendil-works/pi-durable';
import { createHash, randomUUID } from 'node:crypto';
import {
  realpathSync,
  statSync,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import {
  SandboxedExecutionEnv,
  pathLines,
  sandboxAvailable,
  worktreeGitDir,
  writeProfile,
  type SandboxSpec,
} from './sandbox.js';
import { Db, type Notification, type RunRow } from './db.js';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { collectUsage, usageConversationIds } from './usage.js';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import { FileCredentialStore } from './credentials.js';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import { Settings } from './settings.js';
import { DataService } from './data.js';
import { AgentRuntime } from './agents.js';
import { CodexRuntime } from './codex.js';
import {
  RunOrchestrator,
  type DispatchInput,
  type WorkerChoice,
} from './runs.js';
import { resolveWorkerSpec, workerModelChoices } from './run-model.js';
import { EventLog } from './events.js';
import {
  ImprovementStore,
  fingerprintError,
  type IssueContext,
} from './improvements.js';
import { SkillRegistry } from './skills.js';
import { HistoryIndex } from './history.js';
import { GoalStore } from './goals.js';
import { GoalScheduler, parseCron } from './scheduler.js';
import { MemoryWorker, type MemoryTrigger } from './memory-worker.js';
import {
  DREAM_MAX_OUTPUT_TOKENS,
  MemoryDreamer,
  type DreamModel,
} from './memory-dream.js';
import { chiefExtension, type ChiefDeps } from './tools.js';
import { managerExtension, type ManagerDeps } from './manager-tools.js';
import type { ChannelHost } from './channel-host.js';
import { workerExtension } from './worker-tools.js';
import { ManagerLink } from './manager-link.js';
import { NotificationOutbox } from './outbox.js';
import {
  TelegramAdapter,
  fetchBotApi,
  type TelegramSetup,
} from './telegram.js';
import {
  WechatAdapter,
  type WechatSetup,
  type WechatStatus,
} from './wechat.js';
import { toRows, type ConversationView } from '../shared/messages.js';
import type {
  Emit,
  GoalPatch,
  GoalStatus,
  ImprovementItem,
  ImprovementSummary,
  ProjectPatch,
  ProviderConfig,
  ProviderInfo,
  ProviderLoginEvent,
  ScopeInfo,
  SettingsInfo,
  WorkerSettingsInfo,
  RuntimeStatusInfo,
  SessionBinding,
  ConversationInfo,
  TaskItem,
  MemoryRevisionResult,
} from '../shared/types.js';

/**
 * The read-only run surface the chief keeps for oversight (M6): reports,
 * diffs, progress and the run↔manager message thread. Dispatch and mutation
 * belong to the manager alone.
 */
type ChiefRunDeps =
  | 'runReport'
  | 'runDiff'
  | 'runProgress'
  | 'runMessages'
  | 'history';

/** Codex configuration and instructions: read-only inside the Run sandbox. */
const CODEX_CONFIG_FILES = ['config.toml', 'AGENTS.md', 'AGENTS.override.md'];

/** Application composition and conversation/project operations; owned by one resident service. */
export class Service {
  readonly db: Db;
  readonly scopes: Scopes;
  readonly data: DataService;
  readonly runs: RunOrchestrator;
  private readonly codex: CodexRuntime;
  readonly events: EventLog;
  readonly improvements: ImprovementStore;
  readonly skills: SkillRegistry;
  readonly history: HistoryIndex;
  readonly goals: GoalStore;
  readonly scheduler: GoalScheduler;
  readonly memoryWorker: MemoryWorker;
  readonly dreamer: MemoryDreamer;
  private telegram: TelegramAdapter | null = null;
  private wechat: WechatAdapter | null = null;
  private agents: AgentRuntime;
  private settings: Settings;
  private credentials: FileCredentialStore;
  private globalDir: string;
  private loginPrompts = new Map<
    string,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >();
  private loginAborts = new Map<string, AbortController>();
  private promptSeq = 0;
  private watches = new Map<
    string,
    { clientId: number; stop: () => Promise<void> }
  >();
  private watchVersions = new Map<string, number>();
  private inboxWatches = new Map<string, FSWatcher>();
  private inboxTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private maintenance?: ReturnType<typeof setInterval>;
  private memoryTimer?: ReturnType<typeof setInterval>;
  private dreamTimer?: ReturnType<typeof setInterval>;
  readonly managerLink: ManagerLink;
  readonly outbox: NotificationOutbox;
  private closing = false;
  private maintenanceMode = false;
  private openingSessions = new Map<string, Promise<ConversationInfo>>();
  private historyBackfill: Promise<void> | null = null;
  private modelWarmup: Promise<unknown> | null = null;
  private modelWarmupAbort = new AbortController();

  constructor(
    private userDataDir: string,
    private emit: Emit,
    /** Telegram setup resolved by the service entry; absent = adapter off. */
    private telegramSetup: TelegramSetup = {},
    /** WeChat setup resolved by the service entry; absent = adapter off. */
    private wechatSetup: WechatSetup | null = null,
    private options: { warmModels?: boolean; socketPath?: string } = {},
  ) {
    this.db = new Db(userDataDir);
    this.outbox = new NotificationOutbox({
      store: this.db,
      // A scope-level wake with no explicit target (M6): project scopes wake
      // their manager; Global wakes the latest chief conversation (or a fresh
      // one when none exists).
      resolveConversation: async (notification) =>
        notification.scopeId === GLOBAL_SCOPE
          ? await this.chiefConversationId()
          : (await this.openManager(notification.scopeId)).conversationId,
      deliver: (notification, conversationId) =>
        this.deliverNotification(notification, conversationId),
      delivered: (notification, conversationId) =>
        this.recordDelivery(notification, conversationId),
      reportIssue: (area, error, context) =>
        this.reportIssue(area, error, context),
    });
    this.managerLink = new ManagerLink({
      db: this.db,
      openManagerSession: (binding) => this.openBoundSession(binding),
      queueNotification: (notification) => this.outbox.queue(notification),
      requestDelivery: () => this.outbox.request(),
      emitUpdates: () => this.emitUpdates(),
    });
    this.globalDir = join(userDataDir, 'scopes', GLOBAL_SCOPE);
    this.scopes = new Scopes(this.globalDir, this.db);
    this.credentials = new FileCredentialStore(userDataDir);
    this.settings = new Settings(userDataDir, this.credentials);
    this.events = new EventLog(this.db);
    this.skills = new SkillRegistry(this.db, this.events, undefined, () =>
      this.emit('skills', this.skills.list(null)),
    );
    this.agents = new AgentRuntime(
      userDataDir,
      this.globalDir,
      this.settings,
      this.db,
      this.skills,
      (run, inner) => this.sandboxEnv(run, inner),
    );
    this.improvements = new ImprovementStore(this.db);
    this.history = new HistoryIndex(
      this.db,
      this.agents,
      this.events,
      () => !this.maintenanceMode,
      (area, error, context) => this.reportIssue(area, error, context),
    );
    // Memory worker (PRD §4.4 F03): extracts candidate memories from the
    // history index in the background; a trigger never costs a chief turn.
    this.memoryWorker = new MemoryWorker({
      db: this.db,
      scopes: this.scopes,
      history: this.history,
      events: this.events,
      isPaused: () => this.closing || this.maintenanceMode,
      emitMemory: (scopeId) => this.emit('memory', scopeId),
    });
    // Dreaming (D30): an offline review of one Scope's memory against its own
    // recent history. Off unless settings.json sets `dreamModel`.
    this.dreamer = new MemoryDreamer({
      db: this.db,
      scopes: this.scopes,
      history: this.history,
      events: this.events,
      model: () => this.dreamModel(),
      isPaused: () => this.closing || this.maintenanceMode,
      emitMemory: (scopeId) => this.emit('memory', scopeId),
    });
    this.data = new DataService(this.db, this.scopes, emit, {
      onTaskCompleted: (scopeId) =>
        this.triggerMemory(scopeId, 'task-completed'),
      onCorrection: (scopeId) =>
        this.triggerMemory(scopeId, 'user-correction', { force: true }),
    });
    this.codex = new CodexRuntime(this.db, {
      sandboxProfile: (run) => this.codexSandboxProfile(run),
      onUsage: (runId, usage) => {
        const run = this.db.getRun(runId);
        this.events?.record({
          id: `run:${runId}:usage:${randomUUID()}`,
          type: 'run.usage',
          actor: 'system',
          scopeId: run?.projectId ?? '',
          runId,
          summary: `codex usage: ${JSON.stringify(usage)}`,
          payload: { usage },
        });
      },
      // Non-blocking: the notice is queued, the resume does not wait for it.
      onAutoResume: (run) => {
        this.db.queueNotification({
          id: `run:${run.id}:attempt:${run.attempt}:auto-resume`,
          scopeId: run.projectId,
          conversationId: run.chiefConversationId,
          content: `[run ${run.id} resumed]\nThe service restarted while this codex worker ran. Attempt ${run.attempt} resumed automatically from its session (one automatic resume per attempt); the original deadline still applies.`,
        });
        void this.outbox.request();
      },
    });
    this.runs = new RunOrchestrator(
      this.db,
      this.scopes,
      {
        pi: this.agents,
        codex: this.codex,
      },
      userDataDir,
      emit,
      () => this.outbox.request(),
      this.events,
      (area, error, context) => this.reportIssue(area, error, context),
      this.skills,
      {
        limits: () => this.settings.workerLimits(),
        resolveChoice: (input, project) =>
          this.resolveWorkerChoice(input, project),
      },
    );
    this.goals = new GoalStore(this.db);
    this.scheduler = new GoalScheduler({
      db: this.db,
      goals: this.goals,
      ensureGoalConversation: (goalId) => this.ensureGoalConversation(goalId),
      notify: () => this.outbox.request(),
      isPaused: () => this.closing || this.maintenanceMode,
      reportIssue: (area, error, context) =>
        this.reportIssue(area, error, context),
      emitUpdates: () => this.emitUpdates(),
      emitNotice: () => this.emit('notices', this.goals.listNotices(null)),
    });
  }

  async init(maintenance = false): Promise<void> {
    this.maintenanceMode = maintenance;
    await this.agents.open(
      chiefExtension({
        scopes: this.scopes,
        db: this.db,
        data: this.data,
        latestInputEntry: (conversationId) =>
          this.latestInputEntry(conversationId),
        currentInput: (conversationId) => this.currentInput(conversationId),
        goals: this.goals,
        improvements: this.improvements,
        openGoalConversation: (goalId) => this.ensureGoalConversation(goalId),
        emitUpdates: () => this.emitUpdates(),
        emitImprovements: () => this.emitImprovements(),
        emitNotices: () => this.emit('notices', this.goals.listNotices(null)),
        onTaskCompleted: (scopeId) =>
          this.triggerMemory(scopeId, 'task-completed'),
        ...this.sharedRunDeps(),
        delegateToManager: (input) => this.managerLink.delegate(input),
        sendManagerMessage: (input) => this.managerLink.send(input),
        managerMessages: (projectId) => this.data.managerMessages(projectId),
      }),
      workerExtension({
        db: this.db,
        wake: async (notification) => {
          this.outbox.queue(notification);
          await this.outbox.request();
        },
      }),
      managerExtension({
        scopes: this.scopes,
        db: this.db,
        data: this.data,
        goals: this.goals,
        latestInputEntry: (conversationId) =>
          this.latestInputEntry(conversationId),
        currentInput: (conversationId) => this.currentInput(conversationId),
        emitUpdates: () => this.emitUpdates(),
        onTaskCompleted: (scopeId) =>
          this.triggerMemory(scopeId, 'task-completed'),
        ...this.runToolDeps(),
        wakeChief: async (projectId, content, notificationId, taskId) => {
          this.outbox.queue({
            id: notificationId,
            scopeId: projectId,
            // Routed per task: its reportTo, else the latest delegated
            // task's reportTo, else the latest chief conversation (the
            // project-scope fallback cannot apply — a project scope holds
            // only its manager).
            conversationId:
              this.data.managerReportTarget(projectId, taskId) ??
              (await this.chiefConversationId()),
            content,
          });
          await this.outbox.request();
        },
      }),
    );
    if (!maintenance) await this.activate();
    // Keep the process available for health checks while the updater holds maintenance.
    this.maintenance = setInterval(() => {
      if (this.maintenanceMode) return;
      for (const scope of this.listScopes()) {
        try {
          this.watchInbox(scope.id);
          this.scanInbox(scope.id);
        } catch (error) {
          this.reportIssue('inbox.scan', error, { scopeId: scope.id });
        }
      }
      void this.outbox.request();
    }, 60_000);
    this.maintenance.unref();
    // Periodic memory extraction for conversations nobody watches (PRD §4.4).
    this.memoryTimer = setInterval(() => {
      void this.memoryWorker
        .sweep()
        .catch((error) => this.reportIssue('memory.sweep', error));
    }, 5 * 60_000);
    this.memoryTimer.unref();
    // Dreaming is gated per scope by its own interval, back-off and cursor;
    // the timer only decides when the gates are checked.
    this.dreamTimer = setInterval(() => {
      void this.dreamer
        .sweep()
        .catch((error) => this.reportIssue('memory.dream', error));
    }, 15 * 60_000);
    this.dreamTimer.unref();
  }

  private async activate(): Promise<void> {
    await this.runs.recover();
    // Catch the derived history index up in the background; never block startup.
    this.historyBackfill = this.history
      .syncAll()
      .catch((error) => this.reportIssue('history.backfill', error));
    this.scheduler.start();
    await this.managerLink.ensureAll();
    for (const scope of this.listScopes()) {
      this.watchInbox(scope.id);
      this.scanInbox(scope.id);
    }
    await this.outbox.request();
    this.agents.harness.resume();
    // Warm the model catalog on service start: a fresh install has no saved
    // catalog, and an empty one makes the generation task settle every
    // submission unanswered with no_model — silently. Opt-in so tests keep
    // their hermetic no-model behavior; best-effort, a failed refresh
    // keeps the previous catalog.
    if (this.options.warmModels)
      this.modelWarmup ??= this.refreshModels(
        this.modelWarmupAbort.signal,
      ).catch((error) => this.reportIssue('models.warm', error));
    await this.startTelegram();
    await this.startWechat();
  }

  /** The host surface every channel adapter binds to (Telegram, WeChat). */
  private channelHost(): ChannelHost {
    return {
      db: this.db,
      scopes: this.scopes,
      openSession: (binding) => this.openSession(binding),
      openManager: (projectId) => this.openManager(projectId),
      submit: async (conversationId, content, requestId) => {
        await this.submit(conversationId, content, requestId);
      },
      conversation: (id) => this.agents.conversation(id),
      reportIssue: (area, error, context) =>
        this.reportIssue(area, error, context),
    };
  }

  /**
   * Start the WeChat gateway over iLink. It owns its own login: with no stored
   * credentials it publishes a QR code for Settings to show and waits.
   */
  private async startWechat(): Promise<void> {
    if (this.closing || this.maintenanceMode) return;
    const setup = this.wechatSetup;
    // An empty allow-list means nobody may reach the chief: keep the adapter off.
    if (!setup?.config?.allowedUserIds.length) return;
    if (!this.wechat)
      this.wechat = new WechatAdapter(this.channelHost(), setup.config, setup);
    await this.wechat.start();
  }

  wechatStatus(): WechatStatus {
    return (
      this.wechat?.status() ?? {
        enabled: false,
        loggedIn: false,
        accountId: null,
        qrCodeUrl: null,
        scanned: false,
        error: null,
      }
    );
  }

  wechatRelogin(): Promise<WechatStatus> {
    if (!this.wechat) throw new Error('The WeChat channel is not configured');
    return this.wechat.relogin();
  }

  /** Start the Telegram gateway; without a configured token it stays off. */
  private async startTelegram(): Promise<void> {
    if (this.closing || this.maintenanceMode) return;
    const config = this.telegramSetup.config;
    if (!config) return;
    if (!this.telegram)
      this.telegram = new TelegramAdapter(
        this.channelHost(),
        config,
        this.telegramSetup.api ?? fetchBotApi(config.token),
        this.telegramSetup.options,
      );
    await this.telegram.start();
  }

  async activity() {
    const inspection = await this.agents.harness.inspect(BACKGROUND_CONTEXT);
    return {
      tasks: inspection.tasks.length,
      submissions: inspection.submissions.length,
      runs: this.db.activeRuns().length,
      reviews: this.db.unsettledReviews().length,
      maintenance: this.maintenanceMode,
    };
  }
  async beginMaintenance() {
    this.maintenanceMode = true;
    this.outbox.pause();
    this.scheduler.stop();
    try {
      // Stop the gateway before the idle check: its internal submits bypass the
      // server's maintenance gate, so a message accepted after the check would
      // be work the upgrade never saw. stop() settles in-flight submits first.
      await this.telegram?.stop();
      await this.wechat?.stop();
      await this.outbox.idle();
      const activity = await this.activity();
      if (
        activity.tasks ||
        activity.submissions ||
        activity.runs ||
        activity.reviews
      )
        throw new Error(
          'Tasks or conversations are still running. Wait for them to finish before stopping or updating the service.',
        );
      return activity;
    } catch (error) {
      this.maintenanceMode = false;
      this.outbox.resume();
      await this.startTelegram();
      await this.startWechat();
      // Maintenance was refused (work still running): schedules must keep
      // firing instead of staying stopped until the next activate().
      this.scheduler.start();
      throw error;
    }
  }
  async finishMaintenance(): Promise<void> {
    if (!this.maintenanceMode) return;
    this.maintenanceMode = false;
    this.outbox.resume();
    await this.activate();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.modelWarmupAbort.abort();
    this.outbox.pause();
    this.runs.pause();
    this.scheduler.stop();
    this.memoryWorker.stop();
    this.dreamer.stop();
    clearInterval(this.maintenance);
    clearInterval(this.memoryTimer);
    clearInterval(this.dreamTimer);
    await this.telegram?.stop();
    await this.wechat?.stop();
    for (const timer of this.inboxTimers.values()) clearTimeout(timer);
    for (const watcher of this.inboxWatches.values()) watcher.close();
    this.inboxTimers.clear();
    this.inboxWatches.clear();
    this.history.stop();
    await this.history.idle();
    await this.memoryWorker.idle();
    await this.dreamer.idle();
    await this.historyBackfill;
    await this.modelWarmup;
    await this.outbox.idle();
    await Promise.all([...this.watches.values()].map((watch) => watch.stop()));
    this.watches.clear();
    await this.agents.close();
    // External workers are child processes, not durable: kill them so the
    // collectors settle; the next start resumes them automatically.
    await this.codex.close();
    await this.runs.join();
    this.db.close();
  }

  listScopes(): ScopeInfo[] {
    return [
      {
        id: GLOBAL_SCOPE,
        kind: 'global',
        name: 'General',
        rootPath: this.globalDir,
      },
      ...this.db.listProjects().map(
        (project): ScopeInfo => ({
          id: project.id,
          kind: 'project',
          name: project.name,
          rootPath: project.rootPath,
          managerName: project.managerName,
          settings: {
            autoLand: project.autoLand === 1,
            allowInPlace: project.allowInPlace === 1,
            defaultIntent: project.defaultIntent,
            runTimeoutMin: project.runTimeoutMin,
            baseBranch: project.baseBranch,
            promptPreamble: project.promptPreamble,
            managerModel: project.managerModel,
            sandboxMode:
              project.sandboxMode === 'off' ? 'off' : 'workspace-write',
            sandboxNetwork: project.sandboxNetwork === 1,
            sandboxExtraWrite: project.sandboxExtraWrite,
            sandboxAllowRead: project.sandboxAllowRead,
          },
        }),
      ),
    ];
  }
  private projectRoot(rootPath: string): string {
    if (!isAbsolute(rootPath)) throw new Error('Project path must be absolute');
    const root = realpathSync(rootPath);
    if (!statSync(root).isDirectory())
      throw new Error('Project path must be a directory');
    return root;
  }
  /**
   * Register a project together with its manager (D18): the manager name is
   * required and the bound manager conversation is created right away, so a
   * project never exists without the agent that owns its memory.
   */
  async addProject(
    name: string,
    rootPath: string,
    managerName: string,
  ): Promise<ScopeInfo[]> {
    const root = this.projectRoot(rootPath);
    if (
      !name.trim() ||
      this.db.projectByName(name.trim()) ||
      this.db.listProjects().some((project) => project.rootPath === root)
    )
      throw new Error('Project name and directory must be unique');
    if (!managerName.trim()) throw new Error('A project needs a manager name');
    const id = `p-${randomUUID()}`;
    this.db.addProject({
      id,
      name: name.trim(),
      rootPath: root,
      autoLand: 0,
      allowInPlace: 0,
      runTimeoutMin: 0,
      baseBranch: 'main',
      promptPreamble: '',
      managerName: managerName.trim(),
    });
    this.scopes.ensureDirs(id);
    await this.managerLink.open(id);
    this.watchInbox(id);
    this.scanInbox(id);
    const scopes = this.listScopes();
    this.emit('scopes', scopes);
    return scopes;
  }
  async updateProject(id: string, patch: ProjectPatch): Promise<ScopeInfo[]> {
    const existing = this.db.getProject(id);
    if (!existing) throw new Error(`Unknown project: ${id}`);
    if (
      patch.rootPath &&
      patch.rootPath !== existing.rootPath &&
      this.db.projectHasRuns(id)
    )
      throw new Error(
        'Finish and clean up project runs before changing its directory',
      );
    const rootPath = patch.rootPath
      ? this.projectRoot(patch.rootPath)
      : existing.rootPath;
    const name = patch.name?.trim() ?? existing.name;
    if (
      !name ||
      this.db
        .listProjects()
        .some(
          (project) =>
            project.id !== id &&
            (project.name === name || project.rootPath === rootPath),
        )
    )
      throw new Error('Project name and directory must be unique');
    if (patch.managerModel !== undefined && patch.managerModel?.trim())
      this.assertManagerModelRef(patch.managerModel.trim());
    if (patch.defaultIntent !== undefined && patch.defaultIntent?.trim())
      this.settings.assertIntent(patch.defaultIntent.trim());
    this.stopInbox(id);
    this.scopes.forget(id);
    this.db.updateProject(id, {
      ...patch,
      name,
      rootPath,
      // A manager is always named (D18): a blank rename keeps the old name.
      managerName: patch.managerName?.trim() || existing.managerName,
      // '' clears the project-level manager model override (D21).
      managerModel:
        patch.managerModel === undefined
          ? existing.managerModel
          : patch.managerModel?.trim() || null,
      // '' clears the project's default worker Intent (M6).
      defaultIntent:
        patch.defaultIntent === undefined
          ? existing.defaultIntent
          : patch.defaultIntent?.trim() || null,
      autoLand:
        patch.autoLand === undefined
          ? existing.autoLand
          : Number(patch.autoLand),
      allowInPlace:
        patch.allowInPlace === undefined
          ? existing.allowInPlace
          : Number(patch.allowInPlace),
      sandboxMode: patch.sandboxMode ?? existing.sandboxMode,
      sandboxNetwork:
        patch.sandboxNetwork === undefined
          ? existing.sandboxNetwork
          : Number(patch.sandboxNetwork),
      sandboxExtraWrite:
        patch.sandboxExtraWrite?.trim() ?? existing.sandboxExtraWrite,
      sandboxAllowRead:
        patch.sandboxAllowRead?.trim() ?? existing.sandboxAllowRead,
    });
    const cwd = this.scopes.ensureDirs(id);
    await Promise.all(
      this.db
        .listConversations()
        .filter((value) => value.scopeId === id)
        .map(async (conversation) =>
          (
            await this.agents.conversation(conversation.conversationId)
          ).configure({ cwd }, BACKGROUND_CONTEXT),
        ),
    );
    this.watchInbox(id);
    this.scanInbox(id);
    if (patch.managerModel !== undefined) {
      const manager = this.db.managerConversation(id);
      if (manager)
        await (
          await this.agents.conversation(manager.conversationId)
        ).configure({ model: this.managerModelFor(id) }, BACKGROUND_CONTEXT);
    }
    const scopes = this.listScopes();
    this.emit('scopes', scopes);
    return scopes;
  }

  private assertManagerModelRef(ref: string): void {
    const index = ref.indexOf(':');
    if (index <= 0 || !ref.slice(index + 1).trim())
      throw new Error("Manager model must be 'provider:model'");
    const provider = ref.slice(0, index);
    const config = this.settings
      .providers()
      .find((entry) => entry.id === provider);
    if (!config?.enabled) throw new Error(`Unknown provider '${provider}'`);
  }
  async removeProject(id: string): Promise<ScopeInfo[]> {
    if (this.db.projectHasRuns(id))
      throw new Error(
        'Finish and clean up project runs before removing this project',
      );
    // The manager conversation comes with the project (D18); an untouched one
    // goes with it, anything with a transcript keeps the project.
    const manager = this.db.managerConversation(id)?.conversationId;
    const conversations = this.db
      .listConversations()
      .filter((conversation) => conversation.scopeId === id);
    const untouched =
      manager !== undefined &&
      (
        await (
          await this.agents.conversation(manager)
        ).entries({ order: 'ascending' }, 1, undefined, BACKGROUND_CONTEXT)
      ).items.length === 0;
    if (
      conversations.some(
        (conversation) => conversation.conversationId !== manager || !untouched,
      )
    )
      throw new Error('A project with conversations cannot be removed');
    this.stopInbox(id);
    this.scopes.forget(id);
    this.db.removeProject(id);
    this.emit('conversations', this.listConversations());
    const scopes = this.listScopes();
    this.emit('scopes', scopes);
    return scopes;
  }

  listConversations() {
    return this.db.listConversations();
  }
  async createConversation(scopeId: string, manager = false) {
    // A project scope holds only its manager and workers (M6): asking for a
    // conversation in a project opens the manager instead.
    if (!manager && scopeId !== GLOBAL_SCOPE) return this.openManager(scopeId);
    const cwd = this.scopes.ensureDirs(scopeId);
    const conversation = manager
      ? await this.agents.createManager(cwd, this.managerModelFor(scopeId))
      : await this.agents.createChief(cwd);
    const result = this.db.mapConversation(String(conversation.id), scopeId);
    this.emit('conversations', this.listConversations());
    return result;
  }
  async openSession(binding: SessionBinding): Promise<ConversationInfo> {
    // The manager channel is reserved: manager conversations are only
    // created internally through ManagerLink.
    if (binding.channel === 'manager')
      throw new Error('channel "manager" is reserved');
    // A project scope holds only its manager (M6); every other channel
    // binding lives in the Global scope.
    if (binding.scopeId !== GLOBAL_SCOPE)
      throw new Error(
        'a project scope holds only its manager conversation — use openManager',
      );
    return this.openBoundSession(binding);
  }

  /**
   * Tian's direct line to a project's manager: opens (or creates) the
   * bound manager conversation. ManagerLink.open already
   * rejects global and unknown projects, and repeats are idempotent.
   */
  async openManager(projectId: string): Promise<ConversationInfo> {
    return this.managerLink.open(projectId);
  }

  private async openBoundSession(
    binding: SessionBinding,
  ): Promise<ConversationInfo> {
    this.scopes.root(binding.scopeId);
    const existing = this.db.channelSession(binding);
    if (existing) return existing;
    const key = JSON.stringify([
      binding.channel,
      binding.externalId,
      binding.scopeId,
    ]);
    const pending = this.openingSessions.get(key);
    if (pending) return pending;
    const opening = (async () => {
      const conversation = await this.createConversation(
        binding.scopeId,
        binding.channel === 'manager',
      );
      this.db.bindSession(binding, conversation.conversationId);
      // Re-read so the returned ConversationInfo carries the bound role.
      return this.db.channelSession(binding) ?? conversation;
    })();
    this.openingSessions.set(key, opening);
    try {
      return await opening;
    } finally {
      this.openingSessions.delete(key);
    }
  }

  archiveConversation(id: string, archived: boolean): void {
    this.db.conversationScope(id);
    this.db.setConversationArchived(id, archived);
    this.emit('conversations', this.listConversations());
  }

  async submit(id: string, content: string, requestId?: string) {
    const scopeId = this.db.conversationScope(id);
    // A real user submission keeps the default `pi.user` entry (the UI and
    // History expect it); system wakes use their own kinds below so memory
    // provenance can tell them apart.
    const submission = await (
      await this.agents.conversation(id)
    ).submit({ type: 'input', content, requestId }, BACKGROUND_CONTEXT);
    this.db.setConversationTitle(id, content.split('\n')[0].slice(0, 60));
    this.history.touch(id, scopeId);
    this.emit('conversations', this.listConversations());
    void this.settleNotice(id, submission);
    return { submissionId: String(submission.id) };
  }

  /**
   * A submission that settles unanswered (no_model, model_error, aborted)
   * writes no entry of its own — append a system row so the transcript
   * shows the failure instead of staying silent.
   */
  private async settleNotice(
    conversationId: string,
    submission: Submission,
  ): Promise<void> {
    try {
      const result = await submission.wait(BACKGROUND_CONTEXT);
      if (result.status !== 'unanswered') return;
      const conversation = await this.agents.conversation(conversationId);
      // Display-only write (kind + data): pi appends and settles it `done` at
      // once, busy or not — a model-bearing entry could queue behind a
      // boundary and read as in-flight work to the maintenance gate.
      await conversation.submit(
        {
          type: 'write',
          entry: {
            kind: 'tian.unanswered',
            data: `Model did not respond (${result.reason}). Check Settings → Model and the gateway, then retry.`,
          },
        },
        BACKGROUND_CONTEXT,
      );
    } catch (error) {
      this.reportIssue('submit.settle', error, { conversationId });
    }
  }
  async abort(id: string): Promise<void> {
    this.db.conversationScope(id);
    await (await this.agents.conversation(id)).abort(BACKGROUND_CONTEXT);
  }
  async watch(id: string, clientId = 0): Promise<void> {
    const scopeId = this.db.conversationScope(id);
    const key = `${clientId}:${id}`;
    const stopping = this.unwatch(id, clientId);
    const version = this.watchVersions.get(key);
    await stopping;
    const watch = await (
      await this.agents.conversation(id)
    ).watch(BACKGROUND_CONTEXT);
    const current = () =>
      !this.closing && this.watchVersions.get(key) === version;
    if (!current()) {
      await watch.stop();
      return;
    }
    // When a watched conversation goes idle, its turn is complete history —
    // worth an extraction pass (PRD §4.4 F03, Conversation idle).
    let wasBusy = false;
    const publish = (value: unknown) => {
      if (current()) {
        this.history.touch(id, scopeId);
        const snapshot = toRows(value as ConversationView);
        if (wasBusy && !snapshot.busy)
          this.triggerMemory(scopeId, 'conversation-idle');
        wasBusy = snapshot.busy;
        this.emit('view', { conversationId: id, view: snapshot }, clientId);
      }
    };
    publish(watch.value);
    await watch.start(async (value) => {
      publish(value);
    });
    if (!current()) {
      await watch.stop();
      return;
    }
    this.watches.set(key, {
      clientId,
      stop: async () => {
        await watch.stop();
      },
    });
  }
  async unwatch(id: string, clientId = 0): Promise<void> {
    const key = `${clientId}:${id}`;
    this.watchVersions.set(key, (this.watchVersions.get(key) ?? 0) + 1);
    const watch = this.watches.get(key);
    this.watches.delete(key);
    await watch?.stop();
  }
  async releaseClient(clientId: number): Promise<void> {
    for (const [key, version] of this.watchVersions)
      if (key.startsWith(`${clientId}:`))
        this.watchVersions.set(key, version + 1);
    const owned = [...this.watches].filter(
      ([, watch]) => watch.clientId === clientId,
    );
    for (const [key] of owned) this.watches.delete(key);
    await Promise.all(owned.map(([, watch]) => watch.stop()));
  }

  private watchInbox(scopeId: string): void {
    if (this.inboxWatches.has(scopeId) || this.closing) return;
    const directory = join(this.scopes.ensureDirs(scopeId), '.tian', 'inbox');
    const watcher = fsWatch(directory, { persistent: false }, () => {
      clearTimeout(this.inboxTimers.get(scopeId));
      this.inboxTimers.set(
        scopeId,
        setTimeout(() => {
          this.inboxTimers.delete(scopeId);
          try {
            this.scanInbox(scopeId);
          } catch (error) {
            this.reportIssue('inbox.scan', error, { scopeId });
          }
        }, 200),
      );
    });
    watcher.on('error', (error) => {
      this.stopInbox(scopeId);
      this.reportIssue('inbox.watch', error, { scopeId });
    });
    this.inboxWatches.set(scopeId, watcher);
  }
  private stopInbox(scopeId: string): void {
    clearTimeout(this.inboxTimers.get(scopeId));
    this.inboxTimers.delete(scopeId);
    this.inboxWatches.get(scopeId)?.close();
    this.inboxWatches.delete(scopeId);
  }
  private scanInbox(scopeId: string): void {
    if (this.closing || this.maintenanceMode) return;
    // A rescan that changed nothing emits nothing: the renderer refetches the
    // whole inbox on every `inbox` event, so idle scans stay silent.
    let changed = this.scopes.importInbox(scopeId) > 0;
    for (const message of this.scopes.listMessages(scopeId)) {
      if (message.from === 'chief' || message.thread.startsWith('run-'))
        continue;
      if (
        this.outbox.queue({
          id: `inbox:${scopeId}:${message.id}`,
          scopeId,
          conversationId: null,
          content: `[inbox message ${message.id} from ${message.from}]\n${message.body.slice(0, 12_000)}\nRead with check_inbox and act on it.`,
        })
      )
        changed = true;
      this.events.record({
        id: `inbox:${scopeId}:${message.id}`,
        type: 'inbox.received',
        actor: 'channel',
        scopeId,
        summary: `Inbox message from ${message.from}: ${message.body.split('\n')[0].slice(0, 120)}`,
        payload: {
          messageId: message.id,
          from: message.from,
          thread: message.thread,
        },
      });
    }
    if (!changed) return;
    this.emit('inbox', scopeId);
    void this.outbox.request();
  }

  /** Deliver one notification into its conversation (the outbox owns the queue). */
  private async deliverNotification(
    notification: Notification,
    conversationId: string,
  ): Promise<void> {
    if (notification.id.startsWith('run:')) {
      const messageId = `run-${createHash('sha256').update(notification.id).digest('hex')}`;
      this.scopes.sendMessage(
        notification.scopeId,
        'run',
        notification.content,
        undefined,
        messageId,
        messageId,
      );
    }
    await (
      await this.agents.conversation(conversationId)
    ).submit(
      {
        type: 'input',
        content: notification.content,
        requestId: notification.id,
        whenBusy: 'followUp',
        // System wake (goal, run, inbox): never a user statement.
        entry: { kind: 'system.notification' },
      },
      BACKGROUND_CONTEXT,
    );
  }

  private recordDelivery(
    notification: Notification,
    conversationId: string,
  ): void {
    this.events.record({
      id: `notify:${notification.id}:delivered`,
      type: 'notification.delivered',
      actor: 'system',
      scopeId: notification.scopeId,
      conversationId,
      summary: `Notification ${notification.id} delivered: ${notification.content.split('\n')[0].slice(0, 120)}`,
    });
    this.emit('inbox', notification.scopeId);
  }

  getSettings() {
    return this.settings.get();
  }
  usageStats(scopeId: string | null) {
    return collectUsage(this.agents, usageConversationIds(this.db, scopeId));
  }
  getModelCatalog() {
    return this.settings.catalogState();
  }
  async refreshModels(signal?: AbortSignal) {
    const catalog = await this.settings.refreshCatalog(signal);
    this.agents.refreshModels();
    this.emit('settings', this.settings.get());
    return catalog;
  }
  /**
   * The model a conversation runs on: managers use their project's override
   * or the default Manager model (D21), every other conversation the Chief
   * model.
   */
  private managerModelFor(projectId: string): SettingsInfo['model'] {
    const ref = this.db.getProject(projectId)?.managerModel?.trim();
    if (ref) {
      const index = ref.indexOf(':');
      if (index > 0) {
        const provider = ref.slice(0, index);
        const modelId = ref.slice(index + 1);
        if (this.settings.providerIds().has(provider) && modelId)
          return { provider, modelId };
      }
    }
    return this.settings.managerModel();
  }

  private conversationModel(conversationId: string): SettingsInfo['model'] {
    const projectId = this.db.managerProjectId(conversationId);
    return projectId
      ? this.managerModelFor(projectId)
      : this.settings.get().model;
  }

  /** Push each conversation's effective model onto the live harness. */
  private async applyConversationModels(): Promise<void> {
    await Promise.all(
      this.db
        .listConversations()
        .map(async (conversation) =>
          (
            await this.agents.conversation(conversation.conversationId)
          ).configure(
            { model: this.conversationModel(conversation.conversationId) },
            BACKGROUND_CONTEXT,
          ),
        ),
    );
  }

  async setModel(model: SettingsInfo['model']): Promise<void> {
    this.settings.setModel(model);
    await this.applyConversationModels();
    this.emit('settings', this.settings.get());
  }

  async setManagerModel(model: SettingsInfo['model'] | null): Promise<void> {
    this.settings.setManagerModel(model);
    await this.applyConversationModels();
    this.emit('settings', this.settings.get());
  }

  /** Worker runtimes, concurrency limits and intents (M6). */
  /** `<dataDir>/sandbox/<runId>.sb` — kept for audit; unreadable to workers. */
  private get sandboxDir(): string {
    return join(this.userDataDir, 'sandbox');
  }

  /**
   * The Seatbelt spec for one Run, or null when its project opted out.
   * Throws (fail closed) when the sandbox is required but unavailable.
   */
  private sandboxSpec(run: RunRow): SandboxSpec | null {
    const project = this.db.getProject(run.projectId);
    if (project?.sandboxMode !== 'workspace-write') return null;
    if (!sandboxAvailable())
      throw new Error(
        'sandbox-exec is unavailable; the project requires the Seatbelt sandbox',
      );
    const workRoot = realpathSync(run.worktreePath ?? run.rootPath);
    return {
      runId: run.id,
      workRoot,
      gitDir: worktreeGitDir(workRoot),
      dataDir: this.userDataDir,
      socketPath: this.options.socketPath ?? null,
      network: project.sandboxNetwork === 1,
      extraWrite: pathLines(project.sandboxExtraWrite),
      allowRead: pathLines(project.sandboxAllowRead),
    };
  }

  /** AgentRuntime hook: wrap a worker conversation's env when required. */
  private sandboxEnv(run: RunRow, inner: ExecutionEnv): ExecutionEnv {
    const spec = this.sandboxSpec(run);
    if (!spec) return inner;
    return new SandboxedExecutionEnv(
      inner,
      spec,
      writeProfile(spec, this.sandboxDir),
    );
  }

  /**
   * CodexRuntime hook: the per-Run profile for a sandboxed project. Codex
   * keeps its state dir writable — sessions, logs, auth refresh, and the
   * app-server socket live under $CODEX_HOME (verified: a bare `sessions`
   * allow breaks startup) — but its configuration and instructions stay
   * read-only, so a run cannot rewrite the policy of later runs.
   */
  private codexSandboxProfile(run: RunRow): string | null {
    const spec = this.sandboxSpec(run);
    if (!spec) return null;
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
    spec.extraWrite.push(codexHome);
    spec.readOnly = CODEX_CONFIG_FILES.map((file) => join(codexHome, file));
    return writeProfile(spec, this.sandboxDir);
  }

  /** Whether an external runtime's CLI is installed and signed in right now. */
  async runtimeStatus(id: string): Promise<RuntimeStatusInfo> {
    if (id === 'pi')
      return { id, installed: true, signedIn: null, detail: 'built in' };
    if (id === 'codex') return { id, ...(await this.codex.probe()) };
    throw new Error(`Unknown runtime '${id}'`);
  }

  /**
   * Store the worker block. An external runtime that is switched on here
   * must pass its installed-and-signed-in check first (D21).
   */
  async setWorkers(workers: WorkerSettingsInfo): Promise<void> {
    const enabled = this.settings.enabledRuntimes();
    await Promise.all(
      workers.runtimes
        .filter(
          (runtime) =>
            runtime.id !== 'pi' && runtime.enabled && !enabled.has(runtime.id),
        )
        .map(async (runtime) => {
          const status = await this.runtimeStatus(runtime.id);
          if (!status.installed)
            throw new Error(
              `Runtime '${runtime.id}' is not installed: ${status.detail}`,
            );
          if (!status.signedIn)
            throw new Error(`Runtime '${runtime.id}': sign-in required`);
        }),
    );
    this.settings.setWorkers(workers);
    this.emit('settings', this.settings.get());
  }

  /** pi-ai built-in provider ids for the add-provider form (D21). */
  builtinProviderOptions(): {
    id: string;
    name: string;
    oauth: boolean;
  }[] {
    return builtinProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      oauth: Boolean(provider.auth?.oauth),
    }));
  }

  /** Providers with credential metadata — never the secret itself (D21). */
  async listProviders(): Promise<ProviderInfo[]> {
    const credentials = await this.settings.providerInfos();
    const oauth = new Set(
      builtinProviders()
        .filter((provider) => provider.auth?.oauth)
        .map((provider) => provider.id),
    );
    return this.settings.providers().map((config) => {
      const credential = credentials.get(config.id);
      return {
        ...config,
        enabled: config.enabled ?? true,
        models: this.settings.catalogFor(config.id),
        hasKey: credential?.hasKey ?? false,
        keyTail: credential?.keyTail,
        credentialType: credential?.type as 'api_key' | 'oauth' | undefined,
        oauth:
          config.kind === 'builtin' && oauth.has(config.builtinId ?? config.id),
      };
    });
  }

  private async providersChanged(): Promise<void> {
    this.agents.refreshModels();
    this.emit('settings', this.settings.get());
    this.emit('providers', await this.listProviders());
  }

  async addProvider(config: ProviderConfig): Promise<ProviderInfo[]> {
    this.settings.addProvider(config);
    await this.providersChanged();
    return this.listProviders();
  }

  async updateProvider(
    id: string,
    config: ProviderConfig,
  ): Promise<ProviderInfo[]> {
    this.settings.updateProvider(id, config);
    await this.providersChanged();
    return this.listProviders();
  }

  async removeProvider(id: string): Promise<ProviderInfo[]> {
    await this.settings.removeProvider(id);
    await this.providersChanged();
    return this.listProviders();
  }

  async setProviderKey(id: string, key: string): Promise<ProviderInfo[]> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Empty API key');
    if (!this.settings.providerIds().has(id))
      throw new Error(`Unknown provider '${id}'`);
    await this.credentials.modify(id, async () => ({
      type: 'api_key',
      key: trimmed,
    }));
    await this.providersChanged();
    return this.listProviders();
  }

  async deleteProviderKey(id: string): Promise<ProviderInfo[]> {
    await this.credentials.delete(id);
    await this.providersChanged();
    return this.listProviders();
  }

  /**
   * OAuth login through pi-ai: notify events and interactive prompts stream
   * to the renderer as 'providerLogin' events; answers come back through
   * `providerLoginAnswer`, `providerLoginCancel` aborts.
   */
  async providerLogin(providerId: string): Promise<ProviderInfo[]> {
    const config = this.settings
      .providers()
      .find((entry) => entry.id === providerId && entry.enabled);
    if (!config) throw new Error(`Unknown provider '${providerId}'`);
    if (config.kind !== 'builtin')
      throw new Error(
        `Provider '${providerId}' has no OAuth login — set an API key`,
      );
    const controller = new AbortController();
    this.loginAborts.set(providerId, controller);
    const emit = (event: ProviderLoginEvent['event']) =>
      this.emit('providerLogin', { providerId, event });
    try {
      await this.settings.models().login(providerId, 'oauth', {
        signal: controller.signal,
        prompt: (prompt) =>
          new Promise<string>((resolve, reject) => {
            const promptId = `${providerId}:${++this.promptSeq}`;
            this.loginPrompts.set(promptId, { resolve, reject });
            emit({
              type: 'prompt',
              promptId,
              message: prompt.message,
              secret: prompt.type === 'secret',
              placeholder:
                'placeholder' in prompt ? prompt.placeholder : undefined,
              options:
                prompt.type === 'select'
                  ? prompt.options.map((option) => ({
                      id: option.id,
                      label: option.label,
                    }))
                  : undefined,
            });
          }),
        notify: (event) => {
          if (event.type === 'auth_url')
            emit({
              type: 'auth_url',
              url: event.url,
              instructions: event.instructions,
            });
          else if (event.type === 'device_code')
            emit({
              type: 'device_code',
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              expiresInSeconds: event.expiresInSeconds,
            });
          else
            emit({
              type: event.type === 'info' ? 'info' : 'progress',
              message: event.message,
            });
        },
      });
      emit({ type: 'done' });
    } catch (error) {
      emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.loginAborts.delete(providerId);
      for (const [key, pending] of this.loginPrompts)
        if (key.startsWith(`${providerId}:`)) {
          pending.reject(new Error('Login ended'));
          this.loginPrompts.delete(key);
        }
      await this.providersChanged();
    }
    return this.listProviders();
  }

  providerLoginAnswer(
    providerId: string,
    promptId: string,
    answer: string,
  ): void {
    const pending = this.loginPrompts.get(promptId);
    if (!pending || !promptId.startsWith(`${providerId}:`))
      throw new Error('No pending login prompt');
    this.loginPrompts.delete(promptId);
    pending.resolve(answer);
  }

  providerLoginCancel(providerId: string): void {
    this.loginAborts.get(providerId)?.abort();
    for (const [key, pending] of this.loginPrompts)
      if (key.startsWith(`${providerId}:`)) {
        pending.reject(new Error('Login cancelled'));
        this.loginPrompts.delete(key);
      }
  }
  taskList(scopeId: string | null) {
    return this.db.listTasks(scopeId);
  }

  /** All improvement summaries, or those belonging to one scope. */
  improvementList(scopeId: string | null): ImprovementSummary[] {
    return this.improvements.list({ scopeId });
  }

  getImprovementItem(id: string) {
    const entry = this.improvements.get(id);
    if (!entry) throw new Error(`Unknown improvement: ${id}`);
    return entry;
  }

  /** User-authored entry from the Log view. */
  addImprovementItem(
    scopeId: string,
    kind: ImprovementItem['kind'],
    summary: string,
    detail: string,
    severity: ImprovementItem['severity'],
  ) {
    this.scopes.root(scopeId);
    const entry = this.improvements.record({
      scopeId,
      kind,
      summary,
      detail,
      severity,
      source: 'user',
    });
    this.emitImprovements();
    return entry;
  }

  setImprovementStatusItem(
    id: string,
    status: 'open' | 'resolved' | 'dismissed',
  ): ImprovementSummary {
    this.improvements.setStatus(id, status);
    this.emitImprovements();
    return this.improvementSummary(id);
  }

  /** Promote an entry into one deduped task; repeated calls reuse that task. */
  promoteImprovementItem(id: string): ImprovementSummary {
    const promotion = this.improvements.promote(id);
    if (promotion.created) {
      this.events.record({
        id: `improvement:${id}:promoted`,
        type: 'improvement.promoted',
        actor: 'user',
        scopeId: promotion.entry.scopeId,
        taskId: String(promotion.task.id),
        summary: `Improvement ${id} promoted to task #${promotion.task.id}: ${promotion.entry.summary.slice(0, 120)}`,
        payload: { taskId: promotion.task.id, kind: promotion.entry.kind },
      });
    }
    this.emitImprovements();
    this.emit('tasks', this.db.listTasks(null));
    return this.improvementSummary(id);
  }

  /** Best-effort issue report from the renderer; never throws back into UI. */
  reportClientIssue(summary: string, detail: string): void {
    const text = summary.trim();
    if (!text) return;
    try {
      this.improvements.record({
        scopeId: GLOBAL_SCOPE,
        kind: 'issue',
        source: 'system',
        severity: 'medium',
        area: 'renderer',
        summary: text,
        detail,
        fingerprint: fingerprintError('renderer', new Error(text)),
      });
      this.emitImprovements();
    } catch (error) {
      console.error('Renderer issue capture failed:', error);
    }
  }

  /**
   * Fire a memory extraction pass; failures go to the issue sink like every
   * other background task instead of an untracked console line.
   */
  private triggerMemory(
    scopeId: string,
    trigger: MemoryTrigger,
    options?: { force?: boolean },
  ): void {
    void this.memoryWorker
      .trigger(scopeId, trigger, options)
      .catch((error) => this.reportIssue('memory.worker', error, { scopeId }));
  }

  /**
   * The configured Dreaming model (D30), or null when Dreaming is off or the
   * saved model is no longer in the catalog. The prompt is never logged.
   */
  private dreamModel(): DreamModel | null {
    const choice = this.settings.dreamModel();
    if (!choice) return null;
    const models = this.settings.models();
    const model = models.getModel(choice.provider, choice.modelId);
    if (!model) return null;
    return {
      name: `${choice.provider}/${choice.modelId}`,
      complete: async (prompt) => {
        const reply = await models.completeSimple(
          model,
          {
            systemPrompt: prompt.system,
            messages: [
              { role: 'user', content: prompt.user, timestamp: Date.now() },
            ],
          },
          { maxTokens: DREAM_MAX_OUTPUT_TOKENS },
        );
        if (reply.stopReason === 'error')
          throw new Error(reply.errorMessage ?? 'model call failed');
        return {
          text: reply.content
            .map((block) => (block.type === 'text' ? block.text : ''))
            .filter(Boolean)
            .join('\n'),
          usage: { input: reply.usage.input, output: reply.usage.output },
        };
      },
    };
  }

  /**
   * Central automatic issue sink: log the error as before, then record it as a
   * fingerprinted improvement. Capture failures never break the caller.
   */
  reportIssue(area: string, error: unknown, context: IssueContext = {}): void {
    console.error(`${area}:`, error);
    try {
      this.improvements.capture(area, error, context);
      this.emitImprovements();
    } catch (reportError) {
      console.error('Improvement capture failed:', reportError);
    }
  }

  private improvementSummary(id: string): ImprovementSummary {
    const { detail: _detail, ...summary } = this.getImprovementItem(id);
    return summary;
  }

  private emitImprovements(): void {
    this.emit('improvements', this.improvements.list());
  }

  /** The Global chief conversation untargeted wakes may fall back to. */
  private async chiefConversationId(): Promise<string> {
    return (
      this.db.latestConversation(GLOBAL_SCOPE)?.conversationId ??
      (await this.createConversation(GLOBAL_SCOPE)).conversationId
    );
  }

  /** The goal's dedicated chief conversation, created once per goal. */
  private async ensureGoalConversation(goalId: string): Promise<string> {
    // Goals belong to the chief: their conversations live in the Global
    // scope also when the goal's work concerns a project (M6).
    const conversation = await this.openSession({
      channel: 'goal',
      externalId: goalId,
      scopeId: GLOBAL_SCOPE,
    });
    this.goals.setGoalConversation(goalId, conversation.conversationId);
    return conversation.conversationId;
  }

  /**
   * The project's persistent manager conversation, created with the project
   * (or on service start for older projects) and reused afterwards. The
   * manager channel is reserved — this is its only caller.
   */
  private emitUpdates(): void {
    this.emit('tasks', this.db.listTasks(null));
    this.emit('goals', this.goals.listGoals(null));
  }

  goalList(scopeId: string | null) {
    return this.goals.listGoals(scopeId);
  }
  noticeList(scopeId: string | null) {
    return this.goals.listNotices(scopeId);
  }
  async createGoal(
    scopeId: string,
    objective: string,
    successCriteria: string,
    constraints: string,
    maxRunsPerDay: number,
  ) {
    this.scopes.root(scopeId);
    if (!objective.trim()) throw new Error('Goal objective cannot be empty');
    const goal = this.goals.insertGoal({
      scopeId,
      objective,
      successCriteria,
      constraints,
      maxRunsPerDay,
    });
    await this.ensureGoalConversation(goal.id);
    this.emitUpdates();
    return this.goals.getGoal(goal.id)!;
  }
  updateGoal(id: string, patch: GoalPatch) {
    const goal = this.goals.updateGoal(id, patch);
    this.emitUpdates();
    return goal;
  }
  setGoalStatus(id: string, status: GoalStatus) {
    const goal = this.goals.setGoalStatus(id, status);
    this.emitUpdates();
    return goal;
  }
  runGoalNow(id: string): Promise<TaskItem> {
    return this.scheduler.runGoalNow(id);
  }
  addSchedule(goalId: string, cron: string, timezone: string | null) {
    if (!this.goals.getGoal(goalId)) throw new Error(`Unknown goal: ${goalId}`);
    const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { nextFireAt } = parseCron(cron, tz, new Date());
    this.goals.insertSchedule({
      goalId,
      cron: cron.trim(),
      timezone: tz,
      nextFireAt: nextFireAt?.toISOString() ?? null,
    });
    this.emitUpdates();
    return this.goals.getGoal(goalId)!;
  }
  removeSchedule(scheduleId: string) {
    const schedule = this.goals.getSchedule(scheduleId);
    if (!schedule) throw new Error(`Unknown schedule: ${scheduleId}`);
    this.goals.removeSchedule(scheduleId);
    this.emitUpdates();
    return this.goals.getGoal(schedule.goalId)!;
  }
  addTaskItem(scopeId: string, title: string, due: string | null) {
    return this.data.addTask(scopeId, title, due);
  }
  doneTaskItem(id: number, done: boolean) {
    this.data.doneTask(id, done);
  }
  memoryDump(scopeId: string) {
    return this.scopes.memory(scopeId).dump();
  }
  memoryRevise(
    scopeId: string,
    seq: number,
    text: string,
    reason: string,
  ): MemoryRevisionResult {
    // A user editing in the Memory panel is the source of the correction.
    const result = this.data.revise(scopeId, seq, text, reason, 'user', {
      sourceRef: 'ui:memory-panel',
      confirmation: { sourceRef: 'ui:memory-panel', method: 'review' },
      evidence: {
        sourceRef: 'ui:memory-panel',
        excerpt: text,
        actor: 'user',
        relation: 'direct',
        observedAt: new Date().toISOString(),
      },
      trustLevel: 'user_confirmed',
      sourceType: 'user',
    });
    return {
      seq: result.memory.seq,
      supersededSeq: result.superseded.seq,
      changed: result.changed,
      evidenceAdded: result.evidenceAdded,
      coreDropped: result.coreDropped,
    };
  }
  memoryForget(scopeId: string, seq: number, reason: string): void {
    this.data.forget(scopeId, seq, reason, 'user');
  }
  memoryPromote(
    scopeId: string,
    seq: number,
    replacement?: {
      seq: number;
      content: string;
      conditions?: string;
      validUntil?: string | null;
    },
  ): void {
    this.data.promote(
      scopeId,
      seq,
      undefined,
      { sourceRef: 'ui:memory-panel', method: 'review' },
      replacement,
    );
  }
  memoryDismiss(scopeId: string, seq: number): void {
    this.data.dismiss(scopeId, seq);
  }
  memorySelect(scopeId: string, seq: number): void {
    this.data.select(scopeId, seq, 'user');
  }
  memoryDeselect(scopeId: string, seq: number): void {
    this.data.deselect(scopeId, seq, 'user');
  }

  private static readonly INPUT_KINDS = new Set([
    'pi.user',
    'system.notification',
    'worker.input',
  ]);

  private entryText(entry: EntryRecord): string {
    return (entry.model ?? [])
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join(''),
      )
      .join('\n')
      .trim();
  }

  /**
   * Newest input entry of any kind, paging past long tool chains so a source
   * written 40 entries ago is still findable. Any input kind marks a turn:
   * this drives the Core-snapshot refresh, so a wake that arrives after a
   * memory change must not keep serving the previous snapshot.
   */
  private async latestInputEntry(
    conversationId: string,
  ): Promise<string | null> {
    const conversation = await this.agents.conversation(conversationId);
    let cursor: number | undefined;
    for (let pageAt = 0; pageAt < 20; pageAt++) {
      const page = await conversation.entries(
        {
          order: 'descending',
          ...(cursor !== undefined ? { maxEntryId: cursor as EntryId } : {}),
        },
        50,
        undefined,
        BACKGROUND_CONTEXT,
      );
      if (page.items.length === 0) break;
      const found = page.items.find((entry) =>
        Service.INPUT_KINDS.has(entry.kind),
      );
      if (found) return String(found.id);
      const last = page.items.at(-1);
      if (!page.next || !last) break;
      cursor = Number(last.id) - 1;
      if (cursor < 0) break;
    }
    return null;
  }

  /**
   * The current request's input entry and its kind. A system wake or worker
   * input is returned for accurate `sourceRef` binding but can never confirm
   * user provenance; legacy `pi.user` rows whose text exactly matches a
   * delivered notification are treated as the system wakes they were.
   */
  private async currentInput(conversationId: string): Promise<{
    entryId: string;
    kind: 'user' | 'system.notification' | 'worker.input';
    text: string;
  } | null> {
    const conversation = await this.agents.conversation(conversationId);
    let cursor: number | undefined;
    for (let pageAt = 0; pageAt < 20; pageAt++) {
      const page = await conversation.entries(
        {
          order: 'descending',
          ...(cursor !== undefined ? { maxEntryId: cursor as EntryId } : {}),
        },
        50,
        undefined,
        BACKGROUND_CONTEXT,
      );
      if (page.items.length === 0) break;
      for (const entry of page.items) {
        if (!Service.INPUT_KINDS.has(entry.kind)) continue;
        // The newest input is the evidence, even when it carries no text (an
        // image-only or empty submission). Scanning further back would bind
        // this request to an older turn that did not start it.
        const text = this.entryText(entry);
        if (entry.kind === 'pi.user') {
          // Transcripts written before system wakes got their own entry kind
          // stored notification text as `pi.user`; those are system wakes.
          // Return the wake itself (traceable, non-confirming) instead of
          // scanning back to an older user turn that did not start this one.
          if (text && this.db.deliveredNotificationWith(conversationId, text))
            return {
              entryId: String(entry.id),
              kind: 'system.notification',
              text,
            };
          return { entryId: String(entry.id), kind: 'user', text };
        }
        return {
          entryId: String(entry.id),
          kind:
            entry.kind === 'worker.input'
              ? 'worker.input'
              : 'system.notification',
          text,
        };
      }
      const last = page.items.at(-1);
      if (!page.next || !last) break;
      cursor = Number(last.id) - 1;
      if (cursor < 0) break;
    }
    return null;
  }

  inboxList(scopeId: string | null) {
    return this.scopes.listMessages(scopeId);
  }
  runList(scopeId: string | null) {
    return this.db.listRuns(scopeId);
  }
  skillList(scopeId: string | null) {
    return this.skills.list(scopeId);
  }
  skillHistory(scopeId: string, name: string) {
    return this.skills.history(scopeId, name);
  }
  skillApprove(id: string) {
    return this.skills.approve(id);
  }
  skillRetire(id: string, reason: string | null) {
    return this.skills.retire(id, reason);
  }
  skillRollback(id: string, reason: string | null) {
    return this.skills.rollback(id, reason);
  }
  /** The read-only run deps the chief keeps for oversight. */
  private sharedRunDeps() {
    return {
      runReport: (id: string) => this.runs.report(id),
      runDiff: (id: string) => this.runs.diff(id),
      runProgress: (id: string) => this.runs.progress(id),
      runMessages: (runId: string) => this.data.runMessages(runId),
      history: {
        db: this.db,
        events: this.events,
        history: this.history,
      },
    } satisfies Pick<ChiefDeps, ChiefRunDeps> & Pick<ManagerDeps, ChiefRunDeps>;
  }

  /** The full run surface — only the manager extension wires it (M6). */
  private runToolDeps() {
    return {
      dispatch: (input: DispatchInput) => this.dispatchRun(input),
      ...this.sharedRunDeps(),
      stopRun: (id: string, reason?: string) =>
        this.runs.stop(id, { reason, actor: 'manager', strict: true }),
      sendRunMessage: (runId: string, body: string, operationId: string) =>
        this.data.sendRunMessage(runId, body, operationId),
      workerModels: () =>
        workerModelChoices(
          this.settings.workerCatalogs(),
          this.settings.get().model,
        ),
      workerIntents: () => this.settings.workerSettings().intents,
    } satisfies Pick<
      ManagerDeps,
      | 'dispatch'
      | 'stopRun'
      | 'sendRunMessage'
      | 'workerModels'
      | 'workerIntents'
      | ChiefRunDeps
    >;
  }

  /**
   * Turn a dispatch's worker choice into the stored runtime/model/thinking
   * triple (M6, D13). An `intent` is mutually exclusive with explicit
   * runtime/model pins; with neither, the project's default intent applies,
   * falling back to pi with the app-wide model. Pi models validate against
   * the provider catalogs — bad ids must never create a run.
   */
  private resolveWorkerChoice(
    input: DispatchInput,
    project: { defaultIntent: string | null },
  ): WorkerChoice {
    const explicit =
      input.runtime?.trim() ||
      input.model?.trim() ||
      input.thinkingLevel?.trim();
    if (input.intent?.trim() && explicit)
      throw new Error(
        'intent is mutually exclusive with runtime/model/thinking_level — pass one or the other',
      );
    const intentName =
      input.intent?.trim() || (explicit ? null : project.defaultIntent);
    if (intentName) {
      const intent = this.settings.assertIntent(intentName);
      if (!this.settings.enabledRuntimes().has(intent.runtime))
        throw new Error(
          `intent '${intentName}' uses runtime '${intent.runtime}', which is not enabled`,
        );
      if (intent.runtime === 'pi')
        return {
          runtime: 'pi',
          ...resolveWorkerSpec(
            this.settings.workerCatalogs(),
            this.settings.get().model,
            intent.model,
            intent.thinkingLevel,
          ),
        };
      return {
        runtime: intent.runtime,
        model: intent.model ?? null,
        thinkingLevel: intent.thinkingLevel ?? null,
      };
    }
    const runtime = input.runtime?.trim() || 'pi';
    if (!this.settings.enabledRuntimes().has(runtime))
      throw new Error(`Worker runtime '${runtime}' is not enabled`);
    if (runtime === 'pi')
      return {
        runtime,
        ...resolveWorkerSpec(
          this.settings.workerCatalogs(),
          this.settings.get().model,
          input.model,
          input.thinkingLevel,
        ),
      };
    return {
      runtime,
      model: input.model?.trim() || null,
      thinkingLevel: input.thinkingLevel?.trim() || null,
    };
  }

  /**
   * Every dispatch lands here: intent/explicit/default resolution validates
   * the worker choice before the run exists — bad ids must never create a
   * run. Only a project manager may dispatch (M6), so the supervising
   * conversation must be a manager conversation.
   */
  dispatchRun(input: DispatchInput) {
    if (
      !input.chiefConversationId ||
      !this.db.isManagerConversation(input.chiefConversationId)
    )
      throw new Error('only a project manager dispatches workers');
    return this.runs.dispatch(input);
  }
  followUpRun(id: string, prompt: string) {
    return this.runs.followUp(id, prompt);
  }
  async stopRun(id: string) {
    await this.runs.stop(id);
  }
  landRun(id: string) {
    return this.runs.land(id);
  }
  discardRun(id: string) {
    return this.runs.discard(id);
  }
  shipRun(id: string) {
    return this.runs.ship(id);
  }
  runReport(id: string) {
    return this.runs.report(id);
  }
  runDiff(id: string) {
    return this.runs.diff(id);
  }
}
