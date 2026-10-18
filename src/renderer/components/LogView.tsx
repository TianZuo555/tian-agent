import { useMemo, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  Lightbulb,
  Lightning,
  Notebook,
  Plus,
  Sparkle,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type {
  ImprovementKind,
  ImprovementSeverity,
  ImprovementStatus,
  ImprovementSummary,
  ScopeInfo,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { EASE } from './motion-primitives';

type StatusFilter = 'active' | 'done' | 'all';
type KindFilter = 'all' | ImprovementKind;

const KIND_META: Record<
  ImprovementKind,
  { label: string; icon: Icon; className: string }
> = {
  issue: {
    label: 'Issue',
    icon: WarningCircle,
    className: 'bg-destructive/8 text-destructive-foreground',
  },
  friction: {
    label: 'Friction',
    icon: Lightning,
    className: 'bg-warning/8 text-warning-foreground',
  },
  idea: {
    label: 'Idea',
    icon: Lightbulb,
    className: 'bg-secondary text-brand',
  },
  win: {
    label: 'Win',
    icon: Sparkle,
    className: 'bg-success/8 text-success-foreground',
  },
};

const STATUS_META: Record<
  ImprovementStatus,
  {
    label: string;
    variant: 'warning' | 'info' | 'success' | 'outline';
  }
> = {
  open: { label: 'Open', variant: 'warning' },
  promoted: { label: 'Promoted', variant: 'info' },
  resolved: { label: 'Resolved', variant: 'success' },
  dismissed: { label: 'Dismissed', variant: 'outline' },
};

const SEVERITY_META: Record<
  ImprovementSeverity,
  { label: string; dot: string }
> = {
  low: { label: 'Low', dot: 'bg-content-disabled' },
  medium: { label: 'Medium', dot: 'bg-warning' },
  high: { label: 'High', dot: 'bg-destructive' },
};

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All kinds' },
  { value: 'issue', label: 'Issues' },
  { value: 'friction', label: 'Friction' },
  { value: 'idea', label: 'Ideas' },
  { value: 'win', label: 'Wins' },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

const GROUP_ORDER: ImprovementStatus[] = [
  'open',
  'promoted',
  'resolved',
  'dismissed',
];

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

function scopeLabel(scopes: ScopeInfo[], scopeId: string): string {
  return scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId;
}

function sourceLabel(entry: ImprovementSummary): string {
  if (entry.source === 'user') return 'You';
  if (entry.source === 'chief') return 'Chief';
  return 'System';
}

function Header({ count, action }: { count: number; action: React.ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur-md [-webkit-app-region:drag]">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary"
      >
        <Notebook size={12} />
      </span>
      <h1 className="font-medium text-[13px]">Log</h1>
      <span className="font-mono text-[9.5px] text-content-disabled">
        improvement log · {count} open
      </span>
      <div className="ml-auto [-webkit-app-region:no-drag]">{action}</div>
    </header>
  );
}

function SectionLabel({
  label,
  count,
  tone = 'neutral',
}: {
  label: string;
  count: number;
  tone?: 'neutral' | 'brand' | 'warning' | 'success';
}) {
  const dot =
    tone === 'brand'
      ? 'bg-foreground'
      : tone === 'warning'
        ? 'bg-warning'
        : tone === 'success'
          ? 'bg-content-secondary'
          : 'bg-content-disabled/50';
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={`size-1.5 rounded-full ${dot}`} />
      <h2 className="font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.1em]">
        {label}
      </h2>
      <span className="font-mono text-[10px] text-content-disabled/70 tabular-nums">
        {count}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`cursor-pointer rounded-md px-2 py-1 font-medium text-[11px] transition-colors ${
        active
          ? 'bg-secondary text-foreground'
          : 'text-content-secondary hover:bg-secondary/60 hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function MetaRef({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[9.5px] text-content-disabled">
      <span className="uppercase tracking-[0.08em]">{label}</span>
      <span className="truncate text-content-secondary" title={value}>
        {value}
      </span>
    </span>
  );
}

/** Promote / resolve / dismiss / reopen controls for one entry. */
function EntryActions({ entry }: { entry: ImprovementSummary }) {
  const canPromote = entry.status === 'open';
  const canClose = entry.status === 'open' || entry.status === 'promoted';
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {canPromote && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => void actions.promoteImprovement(entry.id)}
        >
          <ArrowRight size={11} />
          Promote
        </Button>
      )}
      {canClose && (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Resolve"
            title="Resolve"
            className="text-content-secondary"
            onClick={() =>
              void actions.setImprovementStatus(entry.id, 'resolved')
            }
          >
            <CheckCircle size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            title="Dismiss"
            className="text-content-secondary"
            onClick={() =>
              void actions.setImprovementStatus(entry.id, 'dismissed')
            }
          >
            <X size={12} />
          </Button>
        </>
      )}
      {!canClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Reopen"
          title="Reopen"
          className="text-content-secondary"
          onClick={() => void actions.setImprovementStatus(entry.id, 'open')}
        >
          <ArrowClockwise size={12} />
        </Button>
      )}
    </div>
  );
}

/** Status, severity, scope, source, and recency chips for one entry. */
function EntryMeta({
  entry,
  scopes,
}: {
  entry: ImprovementSummary;
  scopes: ScopeInfo[];
}) {
  const status = STATUS_META[entry.status];
  const severity = SEVERITY_META[entry.severity];
  const kind = KIND_META[entry.kind];
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={status.variant} size="sm" className="font-mono">
        {status.label}
      </Badge>
      <span className="inline-flex items-center gap-1 font-mono text-[9.5px] text-content-disabled">
        <span className={`size-1.5 rounded-full ${severity.dot}`} />
        {severity.label}
      </span>
      <Badge variant="outline" size="sm" className="font-mono">
        {scopeLabel(scopes, entry.scopeId)}
      </Badge>
      <span className="font-mono text-[9.5px] text-content-disabled">
        {kind.label} · {sourceLabel(entry)}
      </span>
      {entry.area && entry.source === 'system' && (
        <span className="font-mono text-[9.5px] text-content-disabled">
          {entry.area}
        </span>
      )}
      {entry.occurrences > 1 && (
        <Badge variant="secondary" size="sm" className="font-mono">
          ×{entry.occurrences}
        </Badge>
      )}
      <span className="ms-auto font-mono text-[9.5px] text-content-disabled">
        {ago(entry.lastSeenAt)}
      </span>
    </span>
  );
}

function EntryRow({
  entry,
  scopes,
  detail,
  expanded,
  onToggle,
  reduce,
}: {
  entry: ImprovementSummary;
  scopes: ScopeInfo[];
  detail: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  reduce: boolean;
}) {
  const kind = KIND_META[entry.kind];
  const KindIcon = kind.icon;
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
      className="overflow-hidden rounded-xl border border-border bg-card/70"
    >
      <div className="flex items-start gap-2 p-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-lg p-0.5 text-left"
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${kind.className}`}
          >
            <KindIcon size={12} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-words font-medium text-[12px] text-foreground leading-snug">
              {entry.summary}
            </span>
            <EntryMeta entry={entry} scopes={scopes} />
          </span>
        </button>
        <EntryActions entry={entry} />
      </div>

      {/* `layout` animates the size change with a transform; an animated
          `height` would reflow the whole log on every frame. */}
      <motion.div
        layout={!reduce}
        transition={{ duration: 0.18, ease: EASE }}
        className="overflow-hidden"
      >
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="detail"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="border-border border-t"
            >
              <div className="flex flex-col gap-2.5 bg-surface-secondary/20 px-3 py-2.5">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] text-content-secondary leading-relaxed">
                  {detail === undefined
                    ? 'Loading…'
                    : detail.trim() || 'No detail recorded.'}
                </pre>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {entry.taskId != null && (
                    <MetaRef label="task" value={`#${entry.taskId}`} />
                  )}
                  {entry.runId && <MetaRef label="run" value={entry.runId} />}
                  {entry.conversationId && (
                    <MetaRef label="conv" value={entry.conversationId} />
                  )}
                  {entry.eventId && (
                    <MetaRef label="event" value={entry.eventId} />
                  )}
                  {entry.fingerprint && (
                    <MetaRef label="fp" value={entry.fingerprint} />
                  )}
                  <MetaRef
                    label="first"
                    value={entry.firstSeenAt.slice(0, 16).replace('T', ' ')}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}

function NewEntryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const scopes = useStore((s) => s.scopes);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const [kind, setKind] = useState<ImprovementKind>('issue');
  const [severity, setSeverity] = useState<ImprovementSeverity>('medium');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [seed, setSeed] = useState('');
  const generation = open ? 'open' : 'closed';
  if (seed !== generation) {
    setSeed(generation);
    if (open) {
      setKind('issue');
      setSeverity('medium');
      setSummary('');
      setDetail('');
    }
  }
  const label = scopeLabel(scopes, activeScopeId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New log entry</DialogTitle>
          <DialogDescription>
            Record a durable issue, friction point, idea, or win. The Chief can
            also write here while it works.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 font-medium text-[11px] text-content-secondary">
              Kind
            </legend>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(KIND_META) as ImprovementKind[]).map((value) => {
                const meta = KIND_META[value];
                const IconComponent = meta.icon;
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={kind === value ? 'secondary' : 'ghost'}
                    onClick={() => setKind(value)}
                  >
                    <IconComponent size={12} />
                    {meta.label}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-[11px] text-content-secondary">
              Summary
            </span>
            <Input
              value={summary}
              maxLength={300}
              autoFocus
              placeholder="What could be better?"
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-[11px] text-content-secondary">
              Detail
            </span>
            <Textarea
              value={detail}
              maxLength={20_000}
              placeholder="Reproduction, evidence, or the concrete proposal…"
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 font-medium text-[11px] text-content-secondary">
              Severity
            </legend>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(SEVERITY_META) as ImprovementSeverity[]).map(
                (value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={severity === value ? 'secondary' : 'ghost'}
                    onClick={() => setSeverity(value)}
                  >
                    <span
                      className={`size-1.5 rounded-full ${SEVERITY_META[value].dot}`}
                    />
                    {SEVERITY_META[value].label}
                  </Button>
                ),
              )}
            </div>
          </fieldset>
          <p className="font-mono text-[9.5px] text-content-disabled">
            Adding to {label}
          </p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!summary.trim()}
            onClick={async () => {
              await actions.addImprovement(
                kind,
                summary.trim(),
                detail.trim(),
                severity,
              );
              onOpenChange(false);
            }}
          >
            Log entry
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The triage surface for product observations and automatically caught issues. */
export function LogView() {
  const improvements = useStore((s) => s.improvements);
  const details = useStore((s) => s.improvementDetails);
  const scopes = useStore((s) => s.scopes);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [allScopes, setAllScopes] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const reduce = useReducedMotion();

  const open = improvements.filter((entry) => entry.status === 'open').length;
  const promoted = improvements.filter(
    (entry) => entry.status === 'promoted',
  ).length;
  const filtered = useMemo(
    () =>
      improvements.filter((entry) => {
        if (!allScopes && entry.scopeId !== activeScopeId) return false;
        if (kindFilter !== 'all' && entry.kind !== kindFilter) return false;
        if (statusFilter === 'active')
          return entry.status === 'open' || entry.status === 'promoted';
        if (statusFilter === 'done')
          return entry.status === 'resolved' || entry.status === 'dismissed';
        return true;
      }),
    [improvements, allScopes, activeScopeId, kindFilter, statusFilter],
  );
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((status) => ({
        status,
        entries: filtered.filter((entry) => entry.status === status),
      })).filter((group) => group.entries.length > 0),
    [filtered],
  );
  const toggle = (entry: ImprovementSummary) => {
    const next = expanded === entry.id ? null : entry.id;
    setExpanded(next);
    if (next && details[next] === undefined) void actions.loadImprovement(next);
  };

  return (
    <main
      aria-label="Improvement log"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        count={open}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={12} />
            New entry
          </Button>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-border border-b px-4 py-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {STATUS_FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {KIND_FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={kindFilter === filter.value}
              onClick={() => setKindFilter(filter.value)}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <FilterChip active={allScopes} onClick={() => setAllScopes(true)}>
            All scopes
          </FilterChip>
          <FilterChip active={!allScopes} onClick={() => setAllScopes(false)}>
            {scopeLabel(scopes, activeScopeId)}
          </FilterChip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          <div className="mb-5 flex items-baseline gap-3 font-mono text-[10px] text-content-disabled">
            <span>{open} open</span>
            <span>{promoted} promoted</span>
            <span>{improvements.length} total</span>
          </div>

          {groups.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
              <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-content-secondary">
                <Notebook size={16} />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-[13px] text-foreground">
                  {improvements.length === 0
                    ? 'Nothing logged yet.'
                    : 'No entries match this view.'}
                </p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  {improvements.length === 0
                    ? 'Log a product issue, friction point, idea, or win. The Chief also records observations while it works.'
                    : 'Try a different status, kind, or scope filter.'}
                </p>
              </div>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus size={12} />
                New entry
              </Button>
            </div>
          ) : (
            groups.map((group) => (
              <section
                key={group.status}
                aria-label={`${STATUS_META[group.status].label} entries`}
                className="mb-7"
              >
                <SectionLabel
                  label={STATUS_META[group.status].label}
                  count={group.entries.length}
                  tone={
                    group.status === 'open'
                      ? 'warning'
                      : group.status === 'promoted'
                        ? 'brand'
                        : group.status === 'resolved'
                          ? 'success'
                          : 'neutral'
                  }
                />
                <ul className="flex flex-col gap-1.5">
                  <AnimatePresence initial={false}>
                    {group.entries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        scopes={scopes}
                        detail={details[entry.id]}
                        expanded={expanded === entry.id}
                        onToggle={() => toggle(entry)}
                        reduce={Boolean(reduce)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))
          )}
        </div>
      </ScrollArea>

      <NewEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </main>
  );
}
