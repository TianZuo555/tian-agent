import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileCode2,
  GitMerge,
  Inbox,
  Layers,
  ListTodo,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { tian } from '../api';
import { CountPulse } from './motion-primitives';
import type { RunInfo } from '@/shared/types';
import { actions, useStore } from '../store';

type PaneTab = 'tasks' | 'runs' | 'memory' | 'inbox';

const TABS: { id: PaneTab; label: string; icon: typeof ListTodo }[] = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'runs', label: 'Runs', icon: GitMerge },
  { id: 'memory', label: 'Memory', icon: Layers },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
];

/** Discarded/landed/shipped runs read as terminal, whatever status they had. */
function runLabel(run: RunInfo): string {
  if (run.reviewStatus === 'discarded') return 'discarded';
  if (run.reviewStatus === 'landed') return 'landed';
  if (run.reviewStatus === 'shipped') return 'shipped';
  return run.status;
}

const statusVariant: Record<
  string,
  'secondary' | 'outline' | 'success' | 'destructive' | 'warning'
> = {
  running: 'secondary',
  queued: 'outline',
  collecting: 'secondary',
  done: 'success',
  failed: 'destructive',
  interrupted: 'warning',
  discarded: 'outline',
  landed: 'success',
  shipped: 'success',
};

const isLive = (run: RunInfo) =>
  run.status === 'running' ||
  run.status === 'queued' ||
  run.status === 'collecting';

const isDiscarded = (run: RunInfo) => run.reviewStatus === 'discarded';

/** Only pending, finished runs can be landed, shipped, or thrown away. */
const isReviewable = (run: RunInfo) =>
  !isDiscarded(run) &&
  (run.status === 'done' || run.status === 'failed') &&
  run.reviewStatus === 'pending';

const DIFF_OPTIONS = {
  diffStyle: 'unified',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info-basic',
  overflow: 'scroll',
  disableFileHeader: false,
} as const;

function useSystemTheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return dark ? 'dark' : 'light';
}

function DiffView({ patch }: { patch: string }) {
  const themeType = useSystemTheme();
  const files = useMemo<FileDiffMetadata[]>(() => {
    if (!patch.trim()) return [];
    try {
      return parsePatchFiles(patch).flatMap((p) => p.files);
    } catch {
      return [];
    }
  }, [patch]);

  if (files.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-[11px] text-content-secondary">
        No file changes in this run.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {files.map((file) => (
        <FileDiff
          key={`${file.prevName ?? ''}:${file.name}`}
          fileDiff={file}
          options={{ ...DIFF_OPTIONS, themeType }}
          className="overflow-hidden rounded-md border border-border"
        />
      ))}
    </div>
  );
}

/** Task row, Beautiful-UI style: icon, label, trailing meta. */
function TaskRow({ run, onOpen }: { run: RunInfo; onOpen: () => void }) {
  const meta = isLive(run)
    ? { icon: Loader2, spin: true, tone: 'text-info-foreground' }
    : run.status === 'done'
      ? { icon: CheckCircle2, spin: false, tone: 'text-success-foreground' }
      : run.status === 'failed'
        ? { icon: XCircle, spin: false, tone: 'text-destructive-foreground' }
        : { icon: CircleDashed, spin: false, tone: 'text-content-disabled' };
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Run ${run.id}: ${runLabel(run)}`}
      className="group flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary"
    >
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${meta.tone} ${meta.spin ? 'animate-spin' : ''}`}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] leading-snug">
          {run.prompt}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-content-disabled">
          {run.id}
          {run.branch ? <span className="truncate">· {run.branch}</span> : null}
        </span>
      </span>
      <ChevronRight className="mt-0.5 size-3 shrink-0 text-content-disabled opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function RunDetail({ run, onBack }: { run: RunInfo; onBack: () => void }) {
  const [report, setReport] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setPatch(null);
    void tian
      .runReport(run.id)
      .then(setReport)
      .catch((e) => setReport(`Error: ${e}`));
    if (run.branch) {
      void tian
        .runDiff(run.id)
        .then(setPatch)
        .catch((e) => setPatch(`Error: ${e}`));
    }
  }, [run.id, run.branch, run.status]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const reviewable = isReviewable(run);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-border border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back to runs"
          onClick={onBack}
        >
          <ChevronRight className="size-3.5 rotate-180" />
        </Button>
        <span className="truncate font-mono text-[10px] text-content-secondary">
          {run.id}
        </span>
        <Badge
          variant={statusVariant[runLabel(run)] ?? 'outline'}
          size="sm"
          className="ml-auto font-mono"
        >
          {runLabel(run)}
        </Badge>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b px-2 py-1.5">
        {!isDiscarded(run) && (
          <Button
            variant="ghost"
            size="xs"
            loading={busy === 'follow'}
            onClick={() =>
              void act('follow', () => actions.followUpRun(run.id, 'continue'))
            }
          >
            Follow up
          </Button>
        )}
        {run.branch && reviewable && (
          <>
            <Button
              variant="ghost"
              size="xs"
              loading={busy === 'land'}
              onClick={() => void act('land', () => actions.landRun(run.id))}
            >
              <GitMerge className="size-3" />
              Land
            </Button>
            <Button
              variant="ghost"
              size="xs"
              loading={busy === 'ship'}
              onClick={() => void act('ship', () => actions.shipRun(run.id))}
            >
              Ship
            </Button>
          </>
        )}
        {!isDiscarded(run) && (
          <Button
            variant="ghost"
            size="xs"
            className="text-destructive-foreground"
            loading={busy === 'discard'}
            onClick={() =>
              void act('discard', async () => {
                await actions.discardRun(run.id);
                onBack();
              })
            }
          >
            Discard
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="border-border-destructive border-b bg-surface-destructive px-2 py-1.5 text-[11px] text-destructive-foreground"
        >
          {error}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        {run.branch ? (
          patch === null ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-3.5 text-content-secondary" />
            </div>
          ) : (
            <DiffView patch={patch} />
          )
        ) : (
          <div className="px-3 py-6 text-center text-[11px] text-content-secondary">
            No git branch for this run.
          </div>
        )}
        <details className="border-border border-t">
          <summary className="cursor-pointer px-3 py-1.5 font-medium font-mono text-[10px] text-content-secondary uppercase tracking-[0.09em]">
            Report
          </summary>
          <pre className="max-h-72 overflow-auto px-3 pb-3 whitespace-pre-wrap break-words font-mono text-[11px] text-content-secondary leading-relaxed">
            {report ?? 'Loading…'}
          </pre>
        </details>
      </ScrollArea>
    </div>
  );
}

function TasksPanel() {
  const tasks = useStore((s) => s.tasks);
  const [draft, setDraft] = useState('');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="flex flex-col gap-px p-1.5">
          {tasks.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-content-disabled">
              No tasks yet
            </p>
          )}
          {tasks.map((t) => (
            <label
              key={t.id}
              aria-label={`Task: ${t.title}`}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-secondary"
            >
              <Checkbox
                className="mt-0.5"
                checked={t.status === 'done'}
                onCheckedChange={(checked) =>
                  void actions.toggleTask(t.id, checked === true)
                }
              />
              <span
                className={`min-w-0 text-[12px] leading-snug ${
                  t.status === 'done'
                    ? 'text-content-disabled line-through'
                    : 'text-foreground'
                }`}
              >
                {t.title}
                {t.due && (
                  <span className="ml-1.5 font-mono text-[10px] text-content-disabled">
                    {t.due.slice(0, 10)}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </ScrollArea>
      <form
        className="flex shrink-0 items-center gap-1 border-border border-t p-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          await actions.addTask(draft.trim());
          setDraft('');
        }}
      >
        <Input
          size="sm"
          className="text-[11px]"
          aria-label="New task title"
          placeholder="Add a task…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label="Add task"
          disabled={!draft.trim()}
        >
          <ListTodo className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}

function RunsPanel() {
  const runs = useStore((s) => s.runs);
  const [selected, setSelected] = useState<string | null>(null);
  const run = runs.find((r) => r.id === selected) ?? null;

  if (run) return <RunDetail run={run} onBack={() => setSelected(null)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1">
        <span className="font-mono text-[10px] text-content-disabled">
          {runs.length} dispatched
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Refresh runs"
          onClick={() => void actions.refreshRuns()}
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="flex flex-col gap-px p-1.5">
          {runs.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-content-disabled">
              No runs dispatched yet
            </p>
          )}
          {runs.map((r) => (
            <TaskRow key={r.id} run={r} onOpen={() => setSelected(r.id)} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function MemoryPanel() {
  const memory = useStore((s) => s.memory);
  return (
    <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
      <div className="p-2">
        {memory && memory.pendingMerges > 0 && (
          <Badge variant="warning" size="sm" className="mb-2 font-mono">
            {memory.pendingMerges} merges pending
          </Badge>
        )}
        {!memory || memory.lines.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-content-disabled">
            Empty memory
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {memory.lines.map((l, i) => (
              <div
                key={`${i}-${l.slice(0, 12)}`}
                className="flex gap-2 rounded-md px-2 py-1 hover:bg-secondary"
              >
                <span className="shrink-0 font-mono text-[10px] text-content-disabled tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 text-[12px] leading-snug">{l}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function InboxPanel() {
  const inbox = useStore((s) => s.inbox);
  return (
    <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
      <div className="flex flex-col gap-1.5 p-1.5">
        {inbox.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-content-disabled">
            Inbox is empty
          </p>
        )}
        {inbox.map((m) => (
          <div
            key={m.id}
            className={`rounded-md border px-2 py-1.5 text-[11px] ${
              m.read
                ? 'border-border text-content-secondary'
                : 'border-border-sky/40 bg-surface-sky/20 text-foreground'
            }`}
          >
            <div className="mb-1 flex items-center gap-1 font-mono text-[10px] text-content-secondary">
              <span className="truncate">{m.from}</span>
              {m.to && <span>→ {m.to}</span>}
              <span className="ml-auto shrink-0">
                {m.ts.slice(5, 16).replace('T', ' ')}
              </span>
            </div>
            <div className="whitespace-pre-wrap break-words">{m.body}</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/**
 * Right-hand context pane, Codex-style: a segmented tab strip that swaps one
 * inspector panel at a time, with the run list drilling into run detail.
 */
export function ContextPane() {
  const scope = useStore((s) => s.activeScopeId);
  const scopes = useStore((s) => s.scopes);
  const tasks = useStore((s) => s.tasks);
  const runs = useStore((s) => s.runs);
  const inbox = useStore((s) => s.inbox);
  const [tab, setTab] = useState<PaneTab>('tasks');

  const name = scopes.find((s) => s.id === scope)?.name ?? scope;
  const counts: Record<PaneTab, number> = {
    tasks: tasks.filter((t) => t.status === 'open').length,
    runs: runs.filter(isLive).length,
    memory: 0,
    inbox: inbox.filter((m) => !m.read).length,
  };

  return (
    <aside
      aria-label="Context"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-3 [-webkit-app-region:drag]">
        <FileCode2 className="size-3.5 text-content-secondary" />
        <span className="truncate font-medium text-[12px]">Context</span>
        <Badge variant="outline" size="sm" className="ml-auto font-mono">
          {name}
        </Badge>
      </div>

      <div
        role="tablist"
        aria-label="Context sections"
        className="flex shrink-0 items-center gap-0.5 border-border border-b px-1.5 py-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={label}
              onClick={() => setTab(id)}
              className={`relative flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 font-medium text-[11px] transition-colors ${
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-content-secondary hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{label}</span>
              <CountPulse value={counts[id]} />
            </button>
          );
        })}
      </div>

      {tab === 'tasks' && <TasksPanel />}
      {tab === 'runs' && <RunsPanel />}
      {tab === 'memory' && <MemoryPanel />}
      {tab === 'inbox' && <InboxPanel />}
    </aside>
  );
}
