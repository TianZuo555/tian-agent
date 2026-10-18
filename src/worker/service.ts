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
import { chiefExtension } from './tools.js';
import { workerExtension } from './worker-tools.js';
import { toRows, type ConversationView } from '../shared/messages.js';
import type {
  Emit,
  ProjectPatch,
  ScopeInfo,
  SettingsInfo,
  SessionBinding,
  ConversationInfo,
} from '../shared/types.js';

/** Application composition and conversation/project operations; owned by one resident service. */
export class Service {
  readonly db: Db;
  readonly scopes: Scopes;
  readonly data: DataService;
  readonly runs: RunOrchestrator;
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
  private delivery: Promise<void> | null = null;
  private closing = false;
  private maintenanceMode = false;
  private openingSessions = new Map<string, Promise<ConversationInfo>>();

  constructor(
    userDataDir: string,
    private emit: Emit,
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
    this.runs = new RunOrchestrator(
      this.db,
      this.scopes,
      this.agents,
      userDataDir,
      emit,
      () => this.deliverNotifications(),
    );
  }

  async init(maintenance = false): Promise<void> {
    this.maintenanceMode = maintenance;
    await this.agents.open(
      chiefExtension({
        scopes: this.scopes,
        db: this.db,
        data: this.data,
        dispatch: (input) => this.runs.dispatch(input),
        runReport: (id) => this.runs.report(id),
        runDiff: (id) => this.runs.diff(id),
        sendRunMessage: (runId, body, operationId) =>
          this.data.sendRunMessage(runId, body, operationId),
        runMessages: (runId) => this.data.runMessages(runId),
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
          console.error(`Inbox ${scope.id}:`, error);
        }
      }
      void this.deliverNotifications();
    }, 60_000);
    this.maintenance.unref();
  }

  private async activate(): Promise<void> {
    await this.runs.recover();
    for (const scope of this.listScopes()) {
      this.watchInbox(scope.id);
      this.scanInbox(scope.id);
    }
    await this.deliverNotifications();
    this.agents.harness.resume();
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
    try {
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
    clearInterval(this.maintenance);
    for (const timer of this.inboxTimers.values()) clearTimeout(timer);
    for (const watcher of this.inboxWatches.values()) watcher.close();
    this.inboxTimers.clear();
    this.inboxWatches.clear();
    await this.delivery;
    for (const watch of this.watches.values()) await watch.stop();
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
    for (const conversation of this.db
      .listConversations()
      .filter((value) => value.scopeId === id)) {
      await (
        await this.agents.conversation(conversation.conversationId)
      ).configure({ cwd }, BACKGROUND_CONTEXT);
    }
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
    this.db.conversationScope(id);
    const submission = await (
      await this.agents.conversation(id)
    ).submit({ type: 'input', content, requestId }, BACKGROUND_CONTEXT);
    this.db.setConversationTitle(id, content.split('\n')[0].slice(0, 60));
    this.emit('conversations', this.listConversations());
    return { submissionId: String(submission.id) };
  }
  async abort(id: string): Promise<void> {
    this.db.conversationScope(id);
    await (await this.agents.conversation(id)).abort(BACKGROUND_CONTEXT);
  }
  async watch(id: string, clientId = 0): Promise<void> {
    this.db.conversationScope(id);
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
    const publish = (value: unknown) => {
      if (current())
        this.emit(
          'view',
          { conversationId: id, view: toRows(value as ConversationView) },
          clientId,
        );
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
    for (const [key, watch] of this.watches)
      if (watch.clientId === clientId) {
        this.watches.delete(key);
        await watch.stop();
      }
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
            console.error(`Inbox ${scopeId}:`, error);
          }
        }, 200),
      );
    });
    watcher.on('error', (error) => {
      this.stopInbox(scopeId);
      console.error(`Inbox ${scopeId}:`, error);
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
          this.emit('inbox', notification.scopeId);
        } catch (error) {
          console.error(`Notification ${notification.id}:`, error);
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
    for (const conversation of this.db.listConversations()) {
      await (
        await this.agents.conversation(conversation.conversationId)
      ).configure({ model }, BACKGROUND_CONTEXT);
    }
    this.emit('settings', this.settings.get());
  }
  taskList(scopeId: string | null) {
    return this.db.listTasks(scopeId);
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
