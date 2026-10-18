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
  Pencil,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { tian } from '../api';
import { CountPulse } from './motion-primitives';
import type { MemoryItem, RunInfo } from '@/shared/types';
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
  const [showHistory, setShowHistory] = useState(false);
  const [revising, setRevising] = useState<MemoryItem | null>(null);
  const [forgetting, setForgetting] = useState<MemoryItem | null>(null);

  const items = (memory?.items ?? []).filter(
    (item) => showHistory || item.status === 'active',
  );
  const activeCount = (memory?.items ?? []).filter(
    (item) => item.status === 'active',
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-2 py-1">
        <span className="font-mono text-[10px] text-content-disabled">
          {activeCount} active
          {memory && memory.pendingMerges > 0
            ? ` · ${memory.pendingMerges} merges pending`
            : ''}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-content-secondary">
          <Checkbox
            checked={showHistory}
            onCheckedChange={(checked) => setShowHistory(checked === true)}
            aria-label="Show superseded and deleted memories"
          />
          History
        </label>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="flex flex-col gap-px p-1.5">
          {items.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-content-disabled">
              {showHistory ? 'No memories at all' : 'No active memories yet'}
            </p>
          )}
          {items.map((item) => (
            <MemoryRow
              key={item.seq}
              item={item}
              onRevise={() => setRevising(item)}
              onForget={() => setForgetting(item)}
            />
          ))}
        </div>
      </ScrollArea>
      <ReviseMemoryDialog item={revising} onClose={() => setRevising(null)} />
      <ForgetMessageDialog
        item={forgetting}
        onClose={() => setForgetting(null)}
      />
    </div>
  );
}

const trustVariant: Record<string, 'success' | 'secondary' | 'warning'> = {
  user_confirmed: 'success',
  agent_inferred: 'secondary',
  third_party: 'warning',
};

function MemoryRow({
  item,
  onRevise,
  onForget,
}: {
  item: MemoryItem;
  onRevise: () => void;
  onForget: () => void;
}) {
  const historical = item.status !== 'active';
  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-secondary">
      <span
        aria-label={`Memory #${item.seq}`}
        className={`mt-px shrink-0 font-mono text-[10px] tabular-nums ${
          historical ? 'text-content-disabled' : 'text-content-secondary'
        }`}
      >
        #{item.seq}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[12px] leading-snug ${
            historical
              ? 'text-content-disabled line-through'
              : 'text-foreground'
          }`}
        >
          {item.content}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <Badge variant="outline" size="sm" className="font-mono">
            {item.kind}
          </Badge>
          <Badge
            variant={trustVariant[item.trustLevel] ?? 'secondary'}
            size="sm"
            className="font-mono"
          >
            {item.trustLevel}·{item.sourceType}
          </Badge>
          {historical && (
            <Badge
              variant={item.status === 'deleted' ? 'destructive' : 'secondary'}
              size="sm"
              className="font-mono"
            >
              {item.status}
            </Badge>
          )}
          <span className="font-mono text-[10px] text-content-disabled">
            {item.createdAt.slice(0, 10)}
          </span>
        </span>
      </span>
      {!historical && (
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Revise memory #${item.seq}`}
            onClick={onRevise}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive-foreground"
            aria-label={`Forget memory #${item.seq}`}
            onClick={onForget}
          >
            <Trash2 className="size-3" />
          </Button>
        </span>
      )}
    </div>
  );
}

function ReviseMemoryDialog({
  item,
  onClose,
}: {
  item: MemoryItem | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) {
      setText(item.content);
      setReason('');
    }
  }, [item]);

  const submit = async () => {
    if (!item || !text.trim() || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await actions.memoryRevise(item.seq, text.trim(), reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revise memory #{item?.seq}</DialogTitle>
          <DialogDescription>
            The old memory is kept as history but leaves Core Memory.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Field>
            <FieldLabel>Memory</FieldLabel>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={280}
              aria-label="Revised memory text"
            />
          </Field>
          <Field>
            <FieldLabel>Reason</FieldLabel>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being revised?"
              aria-label="Revision reason"
            />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            loading={busy}
            disabled={!text.trim() || !reason.trim()}
            onClick={() => void submit()}
          >
            Revise
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ForgetMessageDialog({
  item,
  onClose,
}: {
  item: MemoryItem | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (item) setReason('');
  }, [item]);

  const submit = async () => {
    if (!item || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await actions.memoryForget(item.seq, reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forget memory #{item?.seq}</DialogTitle>
          <DialogDescription>
            It is marked deleted and leaves Core Memory; the record is kept in
            the version history.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Field>
            <FieldLabel>Reason</FieldLabel>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why should this be forgotten?"
              aria-label="Forget reason"
            />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            variant="destructive"
            loading={busy}
            disabled={!reason.trim()}
            onClick={() => void submit()}
          >
            Forget
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
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
  const memory = useStore((s) => s.memory);
  const counts: Record<PaneTab, number> = {
    tasks: tasks.filter((t) => t.status === 'open').length,
    runs: runs.filter(isLive).length,
    memory: (memory?.items ?? []).filter((m) => m.status === 'active').length,
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
