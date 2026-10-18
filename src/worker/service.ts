import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createHash, randomUUID } from 'node:crypto';
import {
  realpathSync,
  statSync,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { Db } from './db.js';
import { collectUsage, usageConversationIds } from './usage.js';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import { Settings } from './settings.js';
import { DataService } from './data.js';
import { AgentRuntime } from './agents.js';
import { RunOrchestrator, type DispatchInput } from './runs.js';
import { EventLog } from './events.js';
import {
  ImprovementStore,
  fingerprintError,
  type IssueContext,
} from './improvements.js';
import { HistoryIndex } from './history.js';
import { GoalStore } from './goals.js';
import { GoalScheduler, parseCron } from './scheduler.js';
import { MemoryWorker } from './memory-worker.js';
import { chiefExtension } from './tools.js';
import { workerExtension } from './worker-tools.js';
import {
  TelegramAdapter,
  fetchBotApi,
  type TelegramSetup,
} from './telegram.js';
import { toRows, type ConversationView } from '../shared/messages.js';
import type {
  Emit,
  GoalPatch,
  GoalStatus,
  ImprovementItem,
  ImprovementSummary,
  ProjectPatch,
  ScopeInfo,
  SettingsInfo,
  SessionBinding,
  ConversationInfo,
  TaskItem,
} from '../shared/types.js';

/** Application composition and conversation/project operations; owned by one resident service. */
export class Service {
  readonly db: Db;
  readonly scopes: Scopes;
  readonly data: DataService;
  readonly runs: RunOrchestrator;
  readonly events: EventLog;
  readonly improvements: ImprovementStore;
  readonly history: HistoryIndex;
  readonly goals: GoalStore;
  readonly scheduler: GoalScheduler;
  readonly memoryWorker: MemoryWorker;
  private telegram: TelegramAdapter | null = null;
  private agents: AgentRuntime;
  private settings: Settings;
  private globalDir: string;
  private watches = new Map<
    string,
    { clientId: number; stop: () => Promise<void> }
  >();
  private watchVersions = new Map<string, number>();
  private inboxWatches = new Map<string, FSWatcher>();
  private inboxTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private maintenance?: ReturnType<typeof setInterval>;
  private memoryTimer?: ReturnType<typeof setInterval>;
  private delivery: Promise<void> | null = null;
  private closing = false;
  private maintenanceMode = false;
  private openingSessions = new Map<string, Promise<ConversationInfo>>();
  private historyBackfill: Promise<void> | null = null;

  constructor(
    userDataDir: string,
    private emit: Emit,
    /** Telegram setup resolved by the service entry; absent = adapter off. */
    private telegramSetup: TelegramSetup = {},
  ) {
    this.db = new Db(userDataDir);
    this.globalDir = join(userDataDir, 'scopes', GLOBAL_SCOPE);
    this.scopes = new Scopes(this.globalDir, this.db);
    this.settings = new Settings(userDataDir);
    this.data = new DataService(this.db, this.scopes, emit);
    this.agents = new AgentRuntime(
      userDataDir,
      this.globalDir,
      this.settings,
      this.db,
    );
    this.events = new EventLog(this.db);
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
    this.data = new DataService(this.db, this.scopes, emit, {
      onTaskCompleted: (scopeId) => {
        void this.memoryWorker
          .trigger(scopeId, 'task-completed')
          .catch((error) => console.error('Memory worker:', error));
      },
      onCorrection: (scopeId) => {
        void this.memoryWorker
          .trigger(scopeId, 'user-correction', { force: true })
          .catch((error) => console.error('Memory worker:', error));
      },
    });
    this.runs = new RunOrchestrator(
      this.db,
      this.scopes,
      this.agents,
      userDataDir,
      emit,
      () => this.deliverNotifications(),
      this.events,
      (area, error, context) => this.reportIssue(area, error, context),
    );
    this.goals = new GoalStore(this.db);
    this.scheduler = new GoalScheduler({
      db: this.db,
      goals: this.goals,
      ensureGoalConversation: (goalId, scopeId) =>
        this.ensureGoalConversation(goalId, scopeId),
      notify: () => this.deliverNotifications(),
      isPaused: () => this.closing || this.maintenanceMode,
      reportIssue: (area, error, context) =>
        this.reportIssue(area, error, context),
      emitUpdates: () => this.emitUpdates(),
      emitNotice: (scopeId) =>
        this.emit('notices', this.goals.listNotices(scopeId)),
    });
  }

  async init(maintenance = false): Promise<void> {
    this.maintenanceMode = maintenance;
    await this.agents.open(
      chiefExtension({
        scopes: this.scopes,
        db: this.db,
        data: this.data,
        latestUserEntry: (conversationId) =>
          this.latestUserEntry(conversationId),
        goals: this.goals,
        improvements: this.improvements,
        openGoalConversation: (goalId, scopeId) =>
          this.ensureGoalConversation(goalId, scopeId),
        emitUpdates: () => this.emitUpdates(),
        emitImprovements: () => this.emitImprovements(),
        emitNotices: (scopeId) =>
          this.emit('notices', this.goals.listNotices(scopeId)),
        onTaskCompleted: (scopeId) => {
          void this.memoryWorker
            .trigger(scopeId, 'task-completed')
            .catch((error) => console.error('Memory worker:', error));
        },
        dispatch: (input) => this.runs.dispatch(input),
        runReport: (id) => this.runs.report(id),
        runDiff: (id) => this.runs.diff(id),
        sendRunMessage: (runId, body, operationId) =>
          this.data.sendRunMessage(runId, body, operationId),
        runMessages: (runId) => this.data.runMessages(runId),
        history: {
          db: this.db,
          events: this.events,
          history: this.history,
        },
      }),
      workerExtension({
        db: this.db,
        wake: async (notification) => {
          this.db.queueNotification(notification);
          await this.deliverNotifications();
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
      void this.deliverNotifications();
    }, 60_000);
    this.maintenance.unref();
    // Periodic memory extraction for conversations nobody watches (PRD §4.4).
    this.memoryTimer = setInterval(() => {
      void this.memoryWorker
        .sweep()
        .catch((error) => console.error('Memory sweep:', error));
    }, 5 * 60_000);
    this.memoryTimer.unref();
  }

  private async activate(): Promise<void> {
    await this.runs.recover();
    // Catch the derived history index up in the background; never block startup.
    this.historyBackfill = this.history
      .syncAll()
      .catch((error) => this.reportIssue('history.backfill', error));
    this.scheduler.start();
    for (const scope of this.listScopes()) {
      this.watchInbox(scope.id);
      this.scanInbox(scope.id);
    }
    await this.deliverNotifications();
    this.agents.harness.resume();
    await this.startTelegram();
  }

  /** Start the Telegram gateway; without a configured token it stays off. */
  private async startTelegram(): Promise<void> {
    if (this.closing || this.maintenanceMode) return;
    const config = this.telegramSetup.config;
    if (!config) return;
    if (!this.telegram)
      this.telegram = new TelegramAdapter(
        {
          db: this.db,
          scopes: this.scopes,
          openSession: (binding) => this.openSession(binding),
          submit: async (conversationId, content, requestId) => {
            await this.submit(conversationId, content, requestId);
          },
          conversation: (id) => this.agents.conversation(id),
          reportIssue: (area, error, context) =>
            this.reportIssue(area, error, context),
        },
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
    this.scheduler.stop();
    try {
      // Stop the gateway before the idle check: its internal submits bypass the
      // server's maintenance gate, so a message accepted after the check would
      // be work the upgrade never saw. stop() settles in-flight submits first.
      await this.telegram?.stop();
      await this.delivery;
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
      await this.startTelegram();
      // Maintenance was refused (work still running): schedules must keep
      // firing instead of staying stopped until the next activate().
      this.scheduler.start();
      throw error;
    }
  }
  async finishMaintenance(): Promise<void> {
    if (!this.maintenanceMode) return;
    this.maintenanceMode = false;
    await this.activate();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.runs.pause();
    this.scheduler.stop();
    this.memoryWorker.stop();
    clearInterval(this.maintenance);
    clearInterval(this.memoryTimer);
    await this.telegram?.stop();
    for (const timer of this.inboxTimers.values()) clearTimeout(timer);
    for (const watcher of this.inboxWatches.values()) watcher.close();
    this.inboxTimers.clear();
    this.inboxWatches.clear();
    this.history.stop();
    await this.history.idle();
    await this.memoryWorker.idle();
    await this.historyBackfill;
    await this.delivery;
    await Promise.all([...this.watches.values()].map((watch) => watch.stop()));
    this.watches.clear();
    await this.agents.close();
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
          settings: {
            autoLand: project.autoLand === 1,
            allowInPlace: project.allowInPlace === 1,
            agentKind: 'durable-worker',
            runTimeoutMin: project.runTimeoutMin,
            baseBranch: project.baseBranch,
            promptPreamble: project.promptPreamble,
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
  addProject(name: string, rootPath: string): ScopeInfo[] {
    const root = this.projectRoot(rootPath);
    if (
      !name.trim() ||
      this.db.projectByName(name.trim()) ||
      this.db.listProjects().some((project) => project.rootPath === root)
    )
      throw new Error('Project name and directory must be unique');
    const id = `p-${randomUUID()}`;
    this.db.addProject({
      id,
      name: name.trim(),
      rootPath: root,
      autoLand: 0,
      allowInPlace: 0,
      agentKind: 'durable-worker',
      runTimeoutMin: 30,
      baseBranch: 'main',
      promptPreamble: '',
    });
    this.scopes.ensureDirs(id);
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
    this.stopInbox(id);
    this.scopes.forget(id);
    this.db.updateProject(id, {
      ...patch,
      name,
      rootPath,
      autoLand:
        patch.autoLand === undefined
          ? existing.autoLand
          : Number(patch.autoLand),
      allowInPlace:
        patch.allowInPlace === undefined
          ? existing.allowInPlace
          : Number(patch.allowInPlace),
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
    const scopes = this.listScopes();
    this.emit('scopes', scopes);
    return scopes;
  }
  removeProject(id: string): ScopeInfo[] {
    if (this.db.projectHasRuns(id))
      throw new Error(
        'Finish and clean up project runs before removing this project',
      );
    if (
      this.db
        .listConversations()
        .some((conversation) => conversation.scopeId === id)
    )
      throw new Error('A project with conversations cannot be removed');
    this.stopInbox(id);
    this.scopes.forget(id);
    this.db.removeProject(id);
    const scopes = this.listScopes();
    this.emit('scopes', scopes);
    return scopes;
  }

  listConversations() {
    return this.db.listConversations();
  }
  async createConversation(scopeId: string) {
    const conversation = await this.agents.createChief(
      this.scopes.ensureDirs(scopeId),
    );
    const result = this.db.mapConversation(String(conversation.id), scopeId);
    this.emit('conversations', this.listConversations());
    return result;
  }
  async openSession(binding: SessionBinding): Promise<ConversationInfo> {
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
      const conversation = await this.createConversation(binding.scopeId);
      this.db.bindSession(binding, conversation.conversationId);
      return conversation;
    })();
    this.openingSessions.set(key, opening);
    try {
      return await opening;
    } finally {
      this.openingSessions.delete(key);
    }
  }

  async submit(id: string, content: string, requestId?: string) {
    const scopeId = this.db.conversationScope(id);
    const submission = await (
      await this.agents.conversation(id)
    ).submit({ type: 'input', content, requestId }, BACKGROUND_CONTEXT);
    this.db.setConversationTitle(id, content.split('\n')[0].slice(0, 60));
    this.history.touch(id, scopeId);
    this.emit('conversations', this.listConversations());
    return { submissionId: String(submission.id) };
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
          void this.memoryWorker
            .trigger(scopeId, 'conversation-idle')
            .catch((error) => console.error('Memory worker:', error));
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
    for (const message of this.scopes.listMessages(scopeId)) {
      if (message.from === 'chief' || message.thread.startsWith('run-'))
        continue;
      this.db.queueNotification({
        id: `inbox:${scopeId}:${message.id}`,
        scopeId,
        conversationId: null,
        content: `[inbox message ${message.id} from ${message.from}]\n${message.body.slice(0, 12_000)}\nRead with check_inbox and tell Tian what came in.`,
      });
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
    this.emit('inbox', scopeId);
    void this.deliverNotifications();
  }
  private deliverNotifications(): Promise<void> {
    if (this.closing || this.maintenanceMode) return Promise.resolve();
    if (this.delivery) return this.delivery;
    this.delivery = (async () => {
      for (const notification of this.db.pendingNotifications()) {
        if (this.closing || this.maintenanceMode) break;
        try {
          let conversationId = notification.conversationId;
          if (!conversationId) {
            conversationId =
              this.db.latestConversation(notification.scopeId)
                ?.conversationId ??
              (await this.createConversation(notification.scopeId))
                .conversationId;
            this.db.targetNotification(notification.id, conversationId);
          }
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
            },
            BACKGROUND_CONTEXT,
          );
          this.db.deliveredNotification(notification.id);
          this.events.record({
            id: `notify:${notification.id}:delivered`,
            type: 'notification.delivered',
            actor: 'system',
            scopeId: notification.scopeId,
            conversationId,
            summary: `Notification ${notification.id} delivered: ${notification.content.split('\n')[0].slice(0, 120)}`,
          });
          this.emit('inbox', notification.scopeId);
        } catch (error) {
          this.reportIssue('notification.deliver', error, {
            scopeId: notification.scopeId,
            conversationId: notification.conversationId ?? undefined,
          });
        }
      }
    })().finally(() => {
      this.delivery = null;
    });
    return this.delivery;
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
  async refreshModels() {
    const catalog = await this.settings.refreshCatalog();
    this.agents.refreshModels();
    this.emit('settings', this.settings.get());
    return catalog;
  }
  async setModel(model: SettingsInfo['model']): Promise<void> {
    this.settings.setModel(model);
    await Promise.all(
      this.db
        .listConversations()
        .map(async (conversation) =>
          (
            await this.agents.conversation(conversation.conversationId)
          ).configure({ model }, BACKGROUND_CONTEXT),
        ),
    );
    this.emit('settings', this.settings.get());
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

  /** The goal's dedicated chief conversation, created once per goal. */
  private async ensureGoalConversation(
    goalId: string,
    scopeId: string,
  ): Promise<string> {
    const conversation = await this.openSession({
      channel: 'goal',
      externalId: goalId,
      scopeId,
    });
    this.goals.setGoalConversation(goalId, conversation.conversationId);
    return conversation.conversationId;
  }

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
    await this.ensureGoalConversation(goal.id, scopeId);
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
  ): void {
    this.data.revise(scopeId, seq, text, reason, 'user');
  }
  memoryForget(scopeId: string, seq: number, reason: string): void {
    this.data.forget(scopeId, seq, reason, 'user');
  }
  memoryPromote(scopeId: string, seq: number): void {
    this.data.promote(scopeId, seq);
  }
  memoryDismiss(scopeId: string, seq: number): void {
    this.data.dismiss(scopeId, seq);
  }

  /** Newest user entry of a conversation; the Core Memory snapshot refresh marker. */
  private async latestUserEntry(
    conversationId: string,
  ): Promise<string | null> {
    const conversation = await this.agents.conversation(conversationId);
    const page = await conversation.entries(
      { order: 'descending' },
      30,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const user = page.items.find((entry) => entry.kind === 'pi.user');
    return user ? String(user.id) : null;
  }
  inboxList(scopeId: string) {
    return this.scopes.listMessages(scopeId);
  }
  runList(scopeId: string | null) {
    return this.db.listRuns(scopeId);
  }
  dispatchRun(input: DispatchInput) {
    return this.runs.dispatch(input);
  }
  followUpRun(id: string, prompt: string) {
    return this.runs.followUp(id, prompt);
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
