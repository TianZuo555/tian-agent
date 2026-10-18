import {
  Harness,
  createRegistry,
  type Conversation,
  type ConversationId,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { createModels } from '@earendil-works/pi-ai/models';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { createProvider } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  watch as fsWatch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Db, type RunRow } from './db.js';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import { chiefExtension } from './tools.js';
import * as D from './dispatch.js';

export interface ModelChoice {
  provider: string;
  modelId: string;
}

export interface AppSettings {
  model: ModelChoice;
}

const DEFAULT_SETTINGS: AppSettings = {
  model: { provider: 'anthropic', modelId: 'claude-sonnet-5-5' },
};

const PROVIDERS: Record<string, () => ReturnType<typeof createProvider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
};

const PROVIDER_ENV: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  deepseek: 'deepseek-v4-pro',
};

/**
 * pi keeps provider credentials in ~/.pi/agent/auth.json; import api-key
 * entries into env. Returns the providers that got a key — keys refreshed by
 * pi's login flow are more trustworthy than possibly stale env copies.
 */
function loadPiAuth(): string[] {
  const injected: string[] = [];
  try {
    const home = process.env.HOME;
    if (!home) return injected;
    const path = join(home, '.pi/agent/auth.json');
    if (!existsSync(path)) return injected;
    const auth = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      { type?: string; key?: string }
    >;
    for (const [provider, envNames] of Object.entries(PROVIDER_ENV)) {
      const entry = auth[provider];
      if (
        (entry?.type === 'api_key' || entry?.type === 'api-key') &&
        entry.key
      ) {
        for (const name of envNames) process.env[name] = entry.key;
        injected.push(provider);
      }
    }
  } catch {
    // auth file unreadable — rely on env only
  }
  return injected;
}

function providerAvailable(provider: string): boolean {
  return (PROVIDER_ENV[provider] ?? []).some((name) =>
    Boolean(process.env[name]),
  );
}

function defaultSettings(preferred: string[] = []): AppSettings {
  const order = [
    ...preferred,
    ...Object.keys(PROVIDERS).filter((p) => !preferred.includes(p)),
  ];
  for (const provider of order) {
    if (providerAvailable(provider)) {
      return {
        model: { provider, modelId: DEFAULT_MODELS[provider] },
      };
    }
  }
  return DEFAULT_SETTINGS;
}

export type Emit = (channel: string, payload: unknown) => void;

/** Worker-side service: owns the harness, app state, scopes, and view watchers. */
export class Service {
  readonly db: Db;
  readonly scopes: Scopes;
  private harness!: Harness;
  private registry = createRegistry();
  private watches = new Map<string, { stop: () => Promise<unknown> }>();
  private settingsPath: string;
  private settings: AppSettings;
  private globalDir: string;

  constructor(
    private userDataDir: string,
    private emit: Emit,
  ) {
    this.globalDir = join(userDataDir, 'scopes', GLOBAL_SCOPE);
    this.db = new Db(userDataDir);
    this.scopes = new Scopes(this.globalDir, this.db);
    this.settingsPath = join(userDataDir, 'settings.json');
    this.piAuthProviders = loadPiAuth();
    this.settings = this.loadSettings();
  }

  private loadSettings(): AppSettings {
    const fallback = defaultSettings(this.piAuthProviders);
    try {
      if (existsSync(this.settingsPath)) {
        const saved = {
          ...fallback,
          ...JSON.parse(readFileSync(this.settingsPath, 'utf8')),
        };
        if (providerAvailable(saved.model.provider)) return saved;
      }
    } catch {
      // fall through to defaults
    }
    return fallback;
  }

  private piAuthProviders: string[] = [];

  getSettings(): AppSettings {
    return this.settings;
  }

  setModel(model: ModelChoice): void {
    this.settings.model = model;
    writeFileSync(
      this.settingsPath,
      JSON.stringify(this.settings, null, 2),
      'utf8',
    );
  }

  async init(): Promise<void> {
    // Orphaned runs from a dead process get marked; a rerun is a fresh dispatch.
    for (const run of this.db.interruptedOrphans()) {
      this.db.setRunStatus(run.id, 'interrupted');
    }

    const models = createModels();
    for (const make of Object.values(PROVIDERS)) {
      try {
        models.setProvider(make());
      } catch {
        // provider without credentials — skip
      }
    }

    this.registry.install(CodingTools);
    this.registry.install(
      chiefExtension({
        scopes: this.scopes,
        db: this.db,
        dispatch: (o) => this.dispatchRun(o),
      }),
    );

    const storage = await openNodeSqliteStorage(
      join(this.userDataDir, 'pi-session.sqlite'),
    );
    this.harness = await Harness.open(
      storage,
      {
        models,
        registry: this.registry,
        env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? this.globalDir }),
      },
      BACKGROUND_CONTEXT,
    );
    this.harness.resume();

    // inbox watches: global + every registered project
    this.watchInbox(GLOBAL_SCOPE);
    for (const p of this.db.listProjects()) this.watchInbox(p.id);
  }

  async close(): Promise<void> {
    for (const w of this.watches.values()) await w.stop().catch(() => {});
    this.watches.clear();
    for (const w of this.inboxWatches.values()) w.close();
    this.inboxWatches.clear();
    for (const t of this.runTimers.values()) clearTimeout(t);
    this.runTimers.clear();
    await this.harness.close(BACKGROUND_CONTEXT);
    this.db.close();
  }

  // ---- scopes & projects

  listScopes() {
    const projects = this.db.listProjects();
    return [
      {
        id: GLOBAL_SCOPE,
        kind: 'global' as const,
        name: 'General',
        rootPath: this.globalDir,
      },
      ...projects.map((p) => ({
        id: p.id,
        kind: 'project' as const,
        name: p.name,
        rootPath: p.rootPath,
        settings: this.projectSettings(p.id),
      })),
    ];
  }

  addProject(name: string, rootPath: string) {
    const id = `p-${randomUUID().slice(0, 8)}`;
    this.db.addProject({
      id,
      name,
      rootPath,
      autoLand: 0,
      agentKind: 'durable-worker',
      runTimeoutMin: 30,
      baseBranch: 'main',
      promptPreamble: '',
    });
    this.scopes.ensureDirs(id);
    this.watchInbox(id);
    return this.listScopes();
  }

  updateProject(id: string, patch: Record<string, unknown>) {
    this.db.updateProject(id, patch);
    return this.listScopes();
  }

  removeProject(id: string) {
    this.db.removeProject(id);
    return this.listScopes();
  }

  projectSettings(id: string) {
    const p = this.db.getProject(id);
    if (!p) return null;
    return {
      autoLand: p.autoLand === 1,
      agentKind: p.agentKind,
      runTimeoutMin: p.runTimeoutMin,
      baseBranch: p.baseBranch,
      promptPreamble: p.promptPreamble,
    };
  }

  // ---- conversations

  listConversations() {
    return this.db
      .listConversations()
      .map((c) => ({ ...c, scopeId: c.scopeId }));
  }

  async createConversation(scopeId: string) {
    const cwd = this.scopes.ensureDirs(scopeId);
    const conv = await this.harness.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: { model: this.settings.model, cwd },
      },
      BACKGROUND_CONTEXT,
    );
    this.db.mapConversation(String(conv.id), scopeId);
    return {
      conversationId: String(conv.id),
      scopeId,
      title: null as string | null,
    };
  }

  async submit(conversationId: string, content: string) {
    const conv = await this.requireConversation(conversationId);
    const submission = await conv.submit(
      { type: 'input', content },
      BACKGROUND_CONTEXT,
    );
    const scope = this.db.conversationScope(conversationId);
    this.db.setConversationTitle(
      conversationId,
      content.split('\n')[0].slice(0, 60),
    );
    this.emit('conversations', this.listConversations());
    return { submissionId: String(submission.id), scope };
  }

  async abort(conversationId: string) {
    const conv = await this.requireConversation(conversationId);
    await conv.abort(BACKGROUND_CONTEXT);
  }

  private async requireConversation(id: string) {
    const conv = await this.harness.conversation(
      Number(id) as ConversationId,
      BACKGROUND_CONTEXT,
    );
    if (!conv) throw new Error(`unknown conversation ${id}`);
    return conv;
  }

  // ---- watching

  async watch(conversationId: string) {
    if (this.watches.has(conversationId)) return;
    const conv = await this.requireConversation(conversationId);
    const watch = await conv.watch(BACKGROUND_CONTEXT);
    this.emit('view', { conversationId, view: watch.value });
    await watch.start(async (value) => {
      this.emit('view', { conversationId, view: value });
    });
    this.watches.set(conversationId, {
      stop: async () => {
        await watch.stop();
      },
    });
  }

  async unwatch(conversationId: string) {
    const w = this.watches.get(conversationId);
    if (w) {
      this.watches.delete(conversationId);
      await w.stop();
    }
  }

  // ---- dispatch: worktree + durable-worker conversation + collect

  private runConvs = new Map<string, Conversation>();
  private runTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inboxWatches = new Map<string, FSWatcher>();

  /**
   * Spawn a headless worker run for a project: isolated git worktree when the
   * project is a repo (in-place otherwise), a CodingTools-equipped conversation
   * under the same model, report contract baked into instructions. Returns at
   * once; `collectRun` finishes the lifecycle asynchronously.
   */
  async dispatchRun(input: {
    projectRef: string;
    prompt: string;
    chiefConversationId: string | null;
  }): Promise<RunRow> {
    const project =
      this.db.getProject(input.projectRef) ??
      this.db.projectByName(input.projectRef);
    if (!project) throw new Error(`unknown project: ${input.projectRef}`);

    const runId = `r-${randomUUID().slice(0, 8)}`;
    this.scopes.ensureDirs(project.id);
    const reportPath = join(this.scopes.runsDir(project.id), `${runId}.md`);

    let worktreePath: string | null = null;
    let branch: string | null = null;
    if (await D.isGitRepo(project.rootPath)) {
      try {
        const wt = await D.addWorktree(
          project.rootPath,
          project.baseBranch || 'main',
          runId,
          join(this.userDataDir, 'worktrees'),
        );
        worktreePath = wt.worktreePath;
        branch = wt.branch;
      } catch {
        // baseBranch missing or worktree refused — fall back to in-place
      }
    }

    this.db.addRun({
      id: runId,
      projectId: project.id,
      conversationId: null,
      chiefConversationId: input.chiefConversationId,
      agentKind: project.agentKind || 'durable-worker',
      prompt: input.prompt,
      worktreePath,
      branch,
      reportPath,
    });

    const cwd = worktreePath ?? project.rootPath;
    const conv = await this.harness.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: {
          model: this.settings.model,
          cwd,
          extensions: [CodingTools],
          instructions: [
            "You are a worker agent dispatched by Tian's chief of staff. You run unattended — there is no human watching, so never ask questions.",
            'Do the task from the user message inside the current directory only.',
            'Never write to memory/ — memory belongs to the chief, not to you.',
            'When done, write a short report (under a page) to TIAN_REPORT.md in the worktree root: what you did, key decisions, anything the chief should know.',
            'Do not run git commit; the harness commits the worktree itself when you finish.',
            project.promptPreamble
              ? `Project instructions:\n${project.promptPreamble}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      },
      BACKGROUND_CONTEXT,
    );
    this.db.setRunConversation(runId, String(conv.id));
    this.db.setRunStatus(runId, 'running');
    this.runConvs.set(runId, conv);

    await conv.submit(
      { type: 'input', content: input.prompt },
      BACKGROUND_CONTEXT,
    );
    this.emit('runs', this.runList(null));
    void this.collectRun(runId);
    return this.db.getRun(runId)!;
  }

  /** Wait for the worker to go idle, then collect: report, commit, diff stat,
   * status, inbox record, and a wake message to the dispatching chief. */
  private async collectRun(runId: string): Promise<void> {
    const run = this.db.getRun(runId);
    if (!run?.conversationId) return;
    const project = this.db.getProject(run.projectId);
    const conv =
      this.runConvs.get(runId) ??
      (await this.harness.conversation(
        Number(run.conversationId) as ConversationId,
        BACKGROUND_CONTEXT,
      ));
    if (!conv) {
      this.db.setRunStatus(runId, 'interrupted');
      return;
    }
    this.runConvs.set(runId, conv);

    const timeoutMs = Math.max(1, project?.runTimeoutMin ?? 30) * 60_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void conv.abort(BACKGROUND_CONTEXT).catch(() => {});
    }, timeoutMs);
    this.runTimers.set(runId, timer);
    try {
      await conv.waitForIdle(BACKGROUND_CONTEXT);
    } catch {
      // aborted — still collect whatever the worker left
    } finally {
      clearTimeout(timer);
      this.runTimers.delete(runId);
    }

    // collect the report: TIAN_REPORT.md in the worktree, else last reply
    let reportText = '';
    if (run.worktreePath) {
      const inTree = join(run.worktreePath, 'TIAN_REPORT.md');
      if (existsSync(inTree)) {
        reportText = readFileSync(inTree, 'utf8').trim();
        unlinkSync(inTree);
      }
      await D.commitAll(run.worktreePath, `tian run ${runId}`).catch(() => {});
    }
    if (!reportText)
      reportText =
        (await this.lastAssistantText(run.conversationId)) ?? '(no report)';
    if (run.reportPath) {
      mkdirSync(join(run.reportPath, '..'), { recursive: true });
      writeFileSync(run.reportPath, reportText, 'utf8');
    }

    let diffstat = '';
    if (run.worktreePath && run.branch && project) {
      diffstat = await D.diffStat(
        project.rootPath,
        project.baseBranch || 'main',
        run.branch,
      );
    }
    this.db.setRunStatus(runId, timedOut ? 'failed' : 'done');

    let landNote = '';
    if (!timedOut && project?.autoLand === 1 && run.branch) {
      const m = await D.merge(project.rootPath, run.branch);
      landNote =
        m.code === 0
          ? `\nlanded: merged ${run.branch}`
          : `\nland failed: ${m.output.slice(0, 300)}`;
    }

    // record on the project inbox
    const summary = reportText.split('\n').slice(0, 12).join('\n');
    this.scopes.sendMessage(
      run.projectId,
      `run:${runId}`,
      `[run ${timedOut ? 'timed out' : 'done'}] ${run.prompt.split('\n')[0].slice(0, 120)}\n\n${summary}${landNote}`,
      undefined,
      `run-${runId}`,
    );

    // wake the dispatching chief conversation
    const wake = [
      `[run ${runId} finished${timedOut ? ' (timed out)' : ''}] project=${project?.name ?? run.projectId}`,
      `report: ${run.reportPath ?? '(none)'}`,
      diffstat ? `diffstat:\n${diffstat}` : '',
      landNote.trim(),
      'Collect the report, note what matters with note, and tell Tian briefly.',
    ]
      .filter(Boolean)
      .join('\n');
    if (run.chiefConversationId) {
      const chief = await this.harness
        .conversation(
          Number(run.chiefConversationId) as ConversationId,
          BACKGROUND_CONTEXT,
        )
        .catch(() => undefined);
      await chief
        ?.submit({ type: 'input', content: wake }, BACKGROUND_CONTEXT)
        .catch(() => {});
    }

    this.emit('runs', this.runList(null));
    this.emit('inbox', run.projectId);
  }

  /** Extra instruction round on the same worker conversation/worktree. */
  async followUpRun(runId: string, prompt: string): Promise<RunRow> {
    const run = this.db.getRun(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    if (run.status === 'running' || run.status === 'queued')
      throw new Error(`run ${runId} still ${run.status}`);
    if (!run.conversationId) throw new Error(`run ${runId} has no worker`);
    const conv = await this.requireConversation(run.conversationId);
    this.db.reopenRun(runId);
    await conv.submit({ type: 'input', content: prompt }, BACKGROUND_CONTEXT);
    this.emit('runs', this.runList(null));
    void this.collectRun(runId);
    return this.db.getRun(runId)!;
  }

  /** Merge the run's branch into the project's checkout. */
  async landRun(runId: string): Promise<string> {
    const run = this.db.getRun(runId);
    const project = run && this.db.getProject(run.projectId);
    if (!run?.branch || !project)
      throw new Error(`run ${runId} has no branch to land`);
    const m = await D.merge(project.rootPath, run.branch);
    if (m.code !== 0) throw new Error(m.output.slice(0, 500));
    // landed — the worktree is spent
    await D.discardWorktree(project.rootPath, run.worktreePath, null);
    this.emit('runs', this.runList(null));
    return m.output;
  }

  /** Abort (if live) and throw the worktree + branch away. */
  async discardRun(runId: string): Promise<void> {
    const run = this.db.getRun(runId);
    const project = run && this.db.getProject(run.projectId);
    if (!run || !project) throw new Error(`unknown run ${runId}`);
    if (run.status === 'running' || run.status === 'queued') {
      const t = this.runTimers.get(runId);
      if (t) clearTimeout(t);
      const conv = run.conversationId
        ? await this.harness
            .conversation(
              Number(run.conversationId) as ConversationId,
              BACKGROUND_CONTEXT,
            )
            .catch(() => undefined)
        : undefined;
      await conv?.abort(BACKGROUND_CONTEXT).catch(() => {});
    }
    await D.discardWorktree(project.rootPath, run.worktreePath, run.branch);
    this.db.setRunStatus(runId, 'discarded');
    this.emit('runs', this.runList(null));
  }

  /** Push the branch and open a PR with gh. */
  async shipRun(runId: string): Promise<string> {
    const run = this.db.getRun(runId);
    const project = run && this.db.getProject(run.projectId);
    if (!run?.branch || !run.worktreePath || !project)
      throw new Error(`run ${runId} has no branch to ship`);
    const push = await D.git(run.worktreePath, [
      'push',
      '-u',
      'origin',
      run.branch,
    ]);
    if (push.code !== 0) throw new Error(`push: ${push.stderr.slice(0, 300)}`);
    return await new Promise<string>((resolve, reject) => {
      execFile(
        'gh',
        [
          'pr',
          'create',
          '--fill',
          '--base',
          project.baseBranch || 'main',
          '--head',
          run.branch!,
        ],
        { cwd: run.worktreePath ?? project.rootPath },
        (e, stdout, stderr) =>
          e ? reject(new Error(String(stderr || e))) : resolve(String(stdout)),
      );
    });
  }

  async runReport(runId: string): Promise<string> {
    const run = this.db.getRun(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    if (run.reportPath && existsSync(run.reportPath))
      return readFileSync(run.reportPath, 'utf8');
    return '(no report written yet)';
  }

  async runDiff(runId: string): Promise<string> {
    const run = this.db.getRun(runId);
    const project = run && this.db.getProject(run.projectId);
    if (!run?.branch || !project)
      return '(no diff — run was not in a worktree)';
    return D.diff(project.rootPath, project.baseBranch || 'main', run.branch);
  }

  private async lastAssistantText(
    conversationId: string,
  ): Promise<string | undefined> {
    const conv = await this.requireConversation(conversationId);
    const page = await conv.entries(
      { order: 'descending' },
      20,
      undefined,
      BACKGROUND_CONTEXT,
    );
    for (const e of page.items ?? []) {
      if (e.kind !== 'pi.assistant') continue;
      const t = (e.model ?? [])
        .map((msg) =>
          typeof msg.content === 'string'
            ? msg.content
            : (msg.content ?? [])
                .map((c: { text?: string }) => c?.text ?? '')
                .join(''),
        )
        .join('')
        .trim();
      if (t) return t;
    }
    return undefined;
  }

  // ---- inbox fs-watch → renderer refresh + chief wake

  private watchInbox(scopeId: string): void {
    if (this.inboxWatches.has(scopeId)) return;
    let dir: string;
    try {
      dir = join(this.scopes.ensureDirs(scopeId), '.tian', 'inbox');
    } catch {
      return;
    }
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const w = fsWatch(dir, { persistent: false }, (_e, file) => {
      if (!file?.endsWith('.md')) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.emit('inbox', scopeId);
        this.onInboxFile(scopeId, file).catch(() => {});
      }, 300);
    });
    w.on('error', () => {
      w.close();
      this.inboxWatches.delete(scopeId);
    });
    this.inboxWatches.set(scopeId, w);
  }

  /** Wake the scope's chief conversation on external inbox mail. Chief's own
   * posts and run-finish records don't wake (runs wake via chiefConversationId). */
  private async onInboxFile(scopeId: string, file: string): Promise<void> {
    const dir = join(this.scopes.root(scopeId), '.tian', 'inbox');
    const raw = readFileSync(join(dir, file), 'utf8');
    const m = /^---\n([\s\S]*?)\n---/.exec(raw);
    const meta: Record<string, string> = {};
    if (m)
      for (const line of m[1].split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    const from = meta.from ?? '?';
    if (from === 'chief' || (meta.thread ?? '').startsWith('run-')) return;
    await this.wakeScope(
      scopeId,
      `[inbox] new message in this scope from ${from}:\n${raw.slice(0, 2000)}\n\nRead it with check_inbox and tell Tian what came in.`,
    );
  }

  /** Submit a wake input to the scope's latest conversation, creating one when
   * the scope has never been chatted in. */
  private async wakeScope(scopeId: string, text: string): Promise<void> {
    let convId = this.db.latestConversation(scopeId)?.conversationId;
    if (!convId) {
      const c = await this.createConversation(scopeId);
      convId = c.conversationId;
    }
    const conv = await this.harness
      .conversation(Number(convId) as ConversationId, BACKGROUND_CONTEXT)
      .catch(() => undefined);
    await conv
      ?.submit({ type: 'input', content: text }, BACKGROUND_CONTEXT)
      .catch(() => {});
  }

  // ---- data panels (read paths for the renderer)

  taskList(scopeId: string | null) {
    return this.db.listTasks(scopeId);
  }

  addTaskItem(scopeId: string, title: string, due: string | null) {
    const id = this.db.addTask(scopeId, title, due);
    this.emit('tasks', this.taskList(null));
    return id;
  }

  doneTaskItem(id: number, done: boolean) {
    if (done) this.db.doneTask(id);
    else this.db.reopenTask(id);
    this.emit('tasks', this.taskList(null));
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
}
