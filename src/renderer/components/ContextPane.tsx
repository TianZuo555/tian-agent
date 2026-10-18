import { useEffect, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  CaretDoubleRight,
  CaretRight,
  CheckCircle,
  CircleDashed,
  CircleNotch,
  FileCode,
  GitMerge,
  ListChecks,
  PencilSimple,
  Plus,
  Stack,
  Trash,
  Tray,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import { CountPulse, EASE } from './motion-primitives';
import type { MemoryItem, RunInfo } from '@/shared/types';
import { actions, useStore } from '../store';

type PaneTab = 'tasks' | 'runs' | 'memory' | 'inbox';

const TABS: { id: PaneTab; label: string; icon: Icon }[] = [
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'runs', label: 'Runs', icon: GitMerge },
  { id: 'memory', label: 'Memory', icon: Stack },
  { id: 'inbox', label: 'Inbox', icon: Tray },
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
  done: 'secondary',
  failed: 'destructive',
  interrupted: 'warning',
  discarded: 'outline',
  landed: 'secondary',
  shipped: 'secondary',
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
      <div className="px-3 py-8 text-center text-[11px] text-content-secondary">
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
    ? { icon: CircleNotch, spin: true, tone: 'text-info-foreground' }
    : run.status === 'done'
      ? { icon: CheckCircle, spin: false, tone: 'text-content-secondary' }
      : run.status === 'failed'
        ? { icon: XCircle, spin: false, tone: 'text-destructive-foreground' }
        : { icon: CircleDashed, spin: false, tone: 'text-content-disabled' };
  const RunIcon = meta.icon;
  return (
    <motion.button
      layout
      type="button"
      onClick={onOpen}
      aria-label={`Run ${run.id}: ${runLabel(run)}`}
      whileTap={{ scale: 0.99 }}
      className="group flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary"
    >
      <RunIcon
        size={13}
        weight={isLive(run) ? 'regular' : 'fill'}
        className={`mt-0.5 shrink-0 ${meta.tone} ${meta.spin ? 'animate-spin' : ''}`}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] leading-snug">
          {run.prompt}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-content-disabled">
          {run.id}
          {run.branch ? <span className="truncate">· {run.branch}</span> : null}
        </span>
      </span>
      <CaretRight
        size={10}
        className="mt-1 shrink-0 text-content-disabled opacity-0 transition-opacity group-hover:opacity-100"
      />
    </motion.button>
  );
}

function RunDetail({ run, onBack }: { run: RunInfo; onBack: () => void }) {
  const [report, setReport] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

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
    <motion.div
      initial={reduce ? false : { opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: 14 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-border border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Back to runs"
          className="text-content-secondary"
          onClick={onBack}
        >
          <CaretRight size={12} className="rotate-180" />
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
              <GitMerge size={11} />
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
            className="ml-auto text-destructive-foreground"
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
          className="flex items-start gap-1.5 border-border-destructive border-b bg-surface-destructive px-2 py-1.5 text-[11px] text-destructive-foreground"
        >
          <WarningCircle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        {run.branch ? (
          patch === null ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-4 text-content-secondary" />
            </div>
          ) : (
            <DiffView patch={patch} />
          )
        ) : (
          <div className="px-3 py-8 text-center text-[11px] text-content-secondary">
            No git branch for this run.
          </div>
        )}
        <details className="group border-border border-t">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium font-mono text-[9.5px] text-content-secondary uppercase tracking-[0.1em] transition-colors hover:text-foreground">
            <CaretRight
              size={9}
              className="transition-transform duration-200 group-open:rotate-90"
            />
            Report
          </summary>
          <pre className="max-h-72 overflow-auto px-3 pb-3 whitespace-pre-wrap break-words font-mono text-[11px] text-content-secondary leading-relaxed">
            {report ?? 'Loading…'}
          </pre>
        </details>
      </ScrollArea>
    </motion.div>
  );
}

function EmptyPanel({
  icon: IconComponent,
  title,
  hint,
}: {
  icon: Icon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-card text-content-disabled">
        <IconComponent size={16} weight="duotone" />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] text-foreground">{title}</span>
        <span className="max-w-[16rem] text-[11px] text-content-secondary leading-relaxed">
          {hint}
        </span>
      </div>
    </div>
  );
}

function TasksPanel() {
  const tasks = useStore((s) => s.tasks);
  const [draft, setDraft] = useState('');
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="flex flex-col gap-px p-1.5">
          {tasks.length === 0 && (
            <EmptyPanel
              icon={ListChecks}
              title="No tasks yet"
              hint="Add one below or ask the chief to plan."
            />
          )}
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <motion.label
                layout={!reduce}
                key={t.id}
                aria-label={`Task: ${t.title}`}
                initial={reduce ? false : { opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="flex cursor-pointer items-start gap-2 overflow-hidden rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={t.status === 'completed'}
                  onCheckedChange={(checked) =>
                    void actions.toggleTask(t.id, checked === true)
                  }
                />
                <span
                  className={`min-w-0 text-[12px] leading-snug ${
                    t.status === 'completed'
                      ? 'text-content-disabled line-through'
                      : 'text-foreground'
                  }`}
                >
                  {t.title}
                  {t.due && (
                    <span className="ml-1.5 font-mono text-[9.5px] text-content-disabled">
                      {t.due.slice(0, 10)}
                    </span>
                  )}
                </span>
              </motion.label>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
      <form
        className="group flex shrink-0 items-center gap-1 border-border border-t p-1.5"
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
          className="shrink-0 text-content-secondary group-focus-within:text-brand"
          disabled={!draft.trim()}
        >
          <Plus size={13} />
        </Button>
      </form>
    </div>
  );
}

function RunsPanel() {
  const runs = useStore((s) => s.runs);
  const [selected, setSelected] = useState<string | null>(null);
  const run = runs.find((r) => r.id === selected) ?? null;
  const reduce = useReducedMotion();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {run ? (
          <RunDetail key={run.id} run={run} onBack={() => setSelected(null)} />
        ) : (
          <motion.div
            key="list"
            initial={reduce ? false : { opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -10 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1">
              <span className="font-mono text-[9.5px] text-content-disabled">
                {runs.length} dispatched
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto text-content-secondary"
                aria-label="Refresh runs"
                onClick={() => void actions.refreshRuns()}
              >
                <ArrowsClockwise size={12} />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
              <div className="flex flex-col gap-px p-1.5">
                {runs.length === 0 && (
                  <EmptyPanel
                    icon={GitMerge}
                    title="No runs yet"
                    hint="Runs dispatched to a worker will appear here."
                  />
                )}
                {runs.map((r) => (
                  <TaskRow
                    key={r.id}
                    run={r}
                    onOpen={() => setSelected(r.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MemoryPanel() {
  const memory = useStore((s) => s.memory);
  const [showHistory, setShowHistory] = useState(false);
  const [revising, setRevising] = useState<MemoryItem | null>(null);
  const [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const reduce = useReducedMotion();

  const items = (memory?.items ?? []).filter(
    (item) => showHistory || item.status === 'active',
  );
  const activeCount = (memory?.items ?? []).filter(
    (item) => item.status === 'active',
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-2 py-1">
        <span className="font-mono text-[9.5px] text-content-disabled">
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
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        <div className="flex flex-col gap-px p-1.5">
          {items.length === 0 && (
            <EmptyPanel
              icon={Stack}
              title={showHistory ? 'No memories at all' : 'No memories yet'}
              hint="Facts the chief chooses to keep will live here."
            />
          )}
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.seq}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="overflow-hidden"
              >
                <MemoryRow
                  item={item}
                  onRevise={() => setRevising(item)}
                  onForget={() => setForgetting(item)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
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
  user_confirmed: 'secondary',
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
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary">
      <span
        aria-label={`Memory #${item.seq}`}
        className={`mt-px shrink-0 font-mono text-[9.5px] tabular-nums ${
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
        <span className="mt-1 flex flex-wrap items-center gap-1">
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
          <span className="font-mono text-[9.5px] text-content-disabled">
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
            <PencilSimple size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive-foreground"
            aria-label={`Forget memory #${item.seq}`}
            onClick={onForget}
          >
            <Trash size={11} />
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
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      {/* Keyed by memory so the form starts from the selected item instead of
          an effect copying props into state after the first paint. */}
      {item && (
        <ReviseMemoryForm key={item.seq} item={item} onClose={onClose} />
      )}
    </Dialog>
  );
}

function ReviseMemoryForm({
  item,
  onClose,
}: {
  item: MemoryItem;
  onClose: () => void;
}) {
  const [text, setText] = useState(item.content);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await actions.memoryRevise(item.seq, text.trim(), reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revise memory #{item.seq}</DialogTitle>
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
    </>
  );
}

function ForgetMessageDialog({
  item,
  onClose,
}: {
  item: MemoryItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      {item && (
        <ForgetMemoryForm key={item.seq} item={item} onClose={onClose} />
      )}
    </Dialog>
  );
}

function ForgetMemoryForm({
  item,
  onClose,
}: {
  item: MemoryItem;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await actions.memoryForget(item.seq, reason.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPopup className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Forget memory #{item.seq}</DialogTitle>
        <DialogDescription>
          It is marked deleted and leaves Core Memory; the record is kept in the
          version history.
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
  );
}

function InboxPanel() {
  const inbox = useStore((s) => s.inbox);
  const reduce = useReducedMotion();
  return (
    <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
      <div className="flex flex-col gap-1.5 p-1.5">
        {inbox.length === 0 && (
          <EmptyPanel
            icon={Tray}
            title="Inbox is empty"
            hint="Messages from agents and runs land here."
          />
        )}
        <AnimatePresence initial={false}>
          {inbox.map((m) => (
            <motion.div
              layout={!reduce}
              key={m.id}
              initial={reduce ? false : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              className={`rounded-lg border px-2 py-1.5 text-[11px] ${
                m.read
                  ? 'border-border text-content-secondary'
                  : 'border-border-sky/40 bg-surface-sky/20 text-foreground'
              }`}
            >
              <div className="mb-1 flex items-center gap-1 font-mono text-[9.5px] text-content-secondary">
                <span className="truncate">{m.from}</span>
                {m.to && <span>→ {m.to}</span>}
                <span className="ml-auto shrink-0">
                  {m.ts.slice(5, 16).replace('T', ' ')}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </motion.div>
          ))}
        </AnimatePresence>
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
  const reduce = useReducedMotion();

  const name = scopes.find((s) => s.id === scope)?.name ?? scope;
  const memory = useStore((s) => s.memory);
  const counts: Record<PaneTab, number> = {
    tasks: tasks.filter((t) => t.status === 'pending').length,
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
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-md bg-secondary text-content-secondary"
        >
          <FileCode size={12} />
        </span>
        <span className="truncate font-medium text-[12px]">Context</span>
        <Badge
          variant="outline"
          size="sm"
          className="ml-auto font-mono text-[9.5px]"
        >
          {name}
        </Badge>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide context pane"
          className="[-webkit-app-region:no-drag] text-content-secondary"
          onClick={() => actions.setContextOpen(false)}
        >
          <CaretDoubleRight size={13} />
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Context sections"
        className="flex shrink-0 items-center gap-0.5 border-border border-b px-1.5 py-1"
      >
        {TABS.map(({ id, label, icon: TabIcon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={label}
              onClick={() => setTab(id)}
              className={`group relative flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-1.5 font-medium text-[10.5px] transition-colors ${
                active
                  ? 'text-foreground'
                  : 'text-content-secondary hover:bg-surface-tertiary/40 hover:text-foreground'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="context-tab"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 40 }
                  }
                  className="absolute inset-0 rounded-md border border-border bg-surface-tertiary/80"
                />
              )}
              <TabIcon
                size={12}
                weight={active ? 'fill' : 'regular'}
                className={`relative shrink-0 ${
                  active ? 'text-brand' : 'text-content-disabled'
                }`}
              />
              <span className="relative truncate">{label}</span>
              <span className="relative">
                <CountPulse value={counts[id]} />
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: EASE }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === 'tasks' && <TasksPanel />}
          {tab === 'runs' && <RunsPanel />}
          {tab === 'memory' && <MemoryPanel />}
          {tab === 'inbox' && <InboxPanel />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
