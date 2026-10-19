import { useEffect, useId, useMemo, useState } from 'react';
import {
  ArrowsClockwise,
  ArrowCounterClockwise,
  CaretDoubleRight,
  CaretRight,
  CheckCircle,
  CircleDashed,
  CircleNotch,
  Eye,
  EyeSlash,
  FileCode,
  GitMerge,
  Lightning,
  ListChecks,
  PencilSimple,
  Plus,
  Stack,
  Trash,
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

type PaneTab = 'tasks' | 'runs' | 'memory';

const TABS: { id: PaneTab; label: string; icon: Icon }[] = [
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'runs', label: 'Runs', icon: GitMerge },
  { id: 'memory', label: 'Memory', icon: Stack },
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
            Skills ({run.injectedSkills?.length ?? 0})
          </summary>
          <div className="flex flex-col gap-1 px-3 pb-3">
            {(run.injectedSkills ?? []).map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1"
              >
                <Lightning
                  size={10}
                  weight="fill"
                  className="shrink-0 text-content-disabled"
                />
                <span className="truncate font-mono text-[10px] text-content-secondary">
                  {ref.name} v{ref.version}
                </span>
                {run.status === 'failed' && (
                  <Button
                    variant="ghost"
                    size="xs"
                    loading={busy === `skill-${ref.id}`}
                    className="ml-auto h-5 gap-1 px-1.5 font-mono text-[10px] text-content-secondary hover:text-destructive-foreground"
                    onClick={() =>
                      act(`skill-${ref.id}`, () =>
                        actions.skillRollback(ref.id),
                      )
                    }
                  >
                    <ArrowCounterClockwise size={10} />
                    Roll back
                  </Button>
                )}
              </div>
            ))}
          </div>
        </details>
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
  const notice = useStore((s) => s.memoryNotice);
  const historyId = useId();
  const [showHistory, setShowHistory] = useState(false);
  const [revising, setRevising] = useState<MemoryItem | null>(null);
  const [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const reduce = useReducedMotion();

  const items = memory?.items ?? [];
  const candidates = items.filter((item) => item.status === 'candidate');
  const active = items.filter((item) => item.status === 'active');
  const core = active.filter((item) => item.core);
  const searchable = active.filter((item) => !item.core);
  const historical = showHistory
    ? items.filter(
        (item) => item.status === 'superseded' || item.status === 'deleted',
      )
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {notice && (
        <p
          role="status"
          className="shrink-0 border-border border-b bg-surface-amber/20 px-2 py-1 text-[11px] text-content-secondary"
        >
          {notice}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-2 py-1">
        <span className="font-mono text-[9.5px] text-content-disabled">
          {active.length} active
          {candidates.length > 0 ? ` · ${candidates.length} candidates` : ''}
          {memory
            ? ` · core ${memory.core.selected}/${memory.core.budget} tokens ${memory.core.tokens}`
            : ''}
        </span>
        <label
          className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-content-secondary"
          htmlFor={historyId}
        >
          <Checkbox
            id={historyId}
            checked={showHistory}
            onCheckedChange={(checked) => setShowHistory(checked === true)}
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
              hint="Facts the chief keeps, plus candidates extracted from history, live here."
            />
          )}
          {candidates.length > 0 && (
            <div className="px-2 pt-1.5 pb-0.5 font-mono text-[9.5px] tracking-[0.1em] text-content-secondary uppercase">
              Candidates — extracted from history
            </div>
          )}
          <AnimatePresence initial={false}>
            {candidates.map((item) => (
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
                  onPromote={() => void actions.memoryPromote(item.seq)}
                  onDismiss={() => void actions.memoryDismiss(item.seq)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {core.length > 0 && (
            <div className="px-2 pt-1.5 pb-0.5 font-mono text-[9.5px] tracking-[0.1em] text-content-secondary uppercase">
              Core — injected every turn
            </div>
          )}
          <AnimatePresence initial={false}>
            {core.map((item) => (
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
                  onDeselect={() => void actions.memoryDeselect(item.seq)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {searchable.length > 0 && (
            <div className="px-2 pt-1.5 pb-0.5 font-mono text-[9.5px] tracking-[0.1em] text-content-secondary uppercase">
              Active — searchable, not resident
            </div>
          )}
          <AnimatePresence initial={false}>
            {searchable.map((item) => (
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
                  onSelect={() => void actions.memorySelect(item.seq)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {historical.length > 0 && (
            <div className="px-2 pt-1.5 pb-0.5 font-mono text-[9.5px] tracking-[0.1em] text-content-secondary uppercase">
              History
            </div>
          )}
          <AnimatePresence initial={false}>
            {historical.map((item) => (
              <motion.div
                key={item.seq}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="overflow-hidden"
              >
                <MemoryRow item={item} />
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
  onPromote,
  onDismiss,
  onSelect,
  onDeselect,
}: {
  item: MemoryItem;
  onRevise?: () => void;
  onForget?: () => void;
  onPromote?: () => void;
  onDismiss?: () => void;
  onSelect?: () => void;
  onDeselect?: () => void;
}) {
  const candidate = item.status === 'candidate';
  const historical = item.status === 'superseded' || item.status === 'deleted';
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
              : candidate
                ? 'text-content-secondary'
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
          {item.core && (
            <Badge variant="success" size="sm" className="font-mono">
              core
            </Badge>
          )}
          {item.supersedes !== null && item.supersedes !== undefined && (
            <Badge variant="warning" size="sm" className="font-mono">
              replaces #{item.supersedes}
            </Badge>
          )}
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
      {candidate ? (
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Promote memory #${item.seq}`}
            onClick={onPromote}
          >
            <CheckCircle size={11} weight="fill" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive-foreground"
            aria-label={`Dismiss candidate #${item.seq}`}
            onClick={onDismiss}
          >
            <XCircle size={11} />
          </Button>
        </span>
      ) : (
        !historical && (
          <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {item.core ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove memory #${item.seq} from Core`}
                onClick={onDeselect}
              >
                <EyeSlash size={11} />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Select memory #${item.seq} into Core`}
                onClick={onSelect}
              >
                <Eye size={11} />
              </Button>
            )}
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
        )
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
  // The backend limit is 1000 Unicode code points; maxLength counts UTF-16
  // units, so it only guards the input and the error stays authoritative.
  const tooLong = [...text].length > 1000;

  const submit = async () => {
    if (!text.trim() || !reason.trim() || busy || tooLong) return;
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
              maxLength={4000}
              aria-label="Revised memory text"
              aria-invalid={tooLong}
            />
            <p
              className={`text-[10px] ${tooLong ? 'text-destructive-foreground' : 'text-content-disabled'}`}
            >
              {[...text].length}/1000 characters
            </p>
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
            disabled={!text.trim() || !reason.trim() || tooLong}
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

/**
 * Right-hand context pane, Codex-style: a segmented tab strip that swaps one
 * inspector panel at a time, with the run list drilling into run detail.
 */
export function ContextPane() {
  const scope = useStore((s) => s.activeScopeId);
  const scopes = useStore((s) => s.scopes);
  const tasks = useStore((s) => s.tasks);
  const runs = useStore((s) => s.runs);
  const [tab, setTab] = useState<PaneTab>('tasks');
  const reduce = useReducedMotion();

  const name = scopes.find((s) => s.id === scope)?.name ?? scope;
  const memory = useStore((s) => s.memory);
  const counts: Record<PaneTab, number> = {
    tasks: tasks.filter((t) => t.status === 'pending').length,
    runs: runs.filter(isLive).length,
    memory: (memory?.items ?? []).filter((m) => m.status === 'active').length,
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
        tabIndex={-1}
        className="flex shrink-0 items-center gap-0.5 border-border border-b px-1.5 py-1"
        onKeyDown={(e) => {
          // Roving-tabindex arrow navigation per the ARIA tabs pattern.
          const current = TABS.findIndex((t) => t.id === tab);
          let next: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
            next = (current + 1) % TABS.length;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
            next = (current - 1 + TABS.length) % TABS.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = TABS.length - 1;
          if (next === null) return;
          e.preventDefault();
          const nextTab = TABS[next];
          setTab(nextTab.id);
          document.getElementById(`context-tab-${nextTab.id}`)?.focus();
        }}
      >
        {TABS.map(({ id, label, icon: TabIcon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              id={`context-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`context-panel-${id}`}
              tabIndex={active ? 0 : -1}
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
          role="tabpanel"
          id={`context-panel-${tab}`}
          aria-labelledby={`context-tab-${tab}`}
          tabIndex={0}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -3 }}
          transition={{ duration: 0.16, ease: EASE }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {tab === 'tasks' && <TasksPanel />}
          {tab === 'runs' && <RunsPanel />}
          {tab === 'memory' && <MemoryPanel />}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
