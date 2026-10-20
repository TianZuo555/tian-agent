import { useId, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import type {
  ImprovementKind,
  ImprovementSeverity,
  ImprovementStatus,
  ImprovementSummary,
  ScopeInfo,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { t, useT, type MessageKey } from '../i18n';
import { EASE } from './motion-primitives';

type StatusFilter = 'active' | 'done' | 'all';
type KindFilter = 'all' | ImprovementKind;

const KIND_META: Record<
  ImprovementKind,
  { label: MessageKey; icon: Icon; className: string }
> = {
  issue: {
    label: 'log.kind.issue',
    icon: WarningCircle,
    className: 'bg-destructive/8 text-destructive-foreground',
  },
  friction: {
    label: 'log.kind.friction',
    icon: Lightning,
    className: 'bg-warning/8 text-warning-foreground',
  },
  idea: {
    label: 'log.kind.idea',
    icon: Lightbulb,
    className: 'bg-secondary text-brand',
  },
  win: {
    label: 'log.kind.win',
    icon: Sparkle,
    className: 'bg-success/8 text-success-foreground',
  },
};

const STATUS_META: Record<
  ImprovementStatus,
  {
    label: MessageKey;
    variant: 'warning' | 'info' | 'success' | 'outline';
  }
> = {
  open: { label: 'log.status.open', variant: 'warning' },
  promoted: { label: 'log.status.promoted', variant: 'info' },
  resolved: { label: 'log.status.resolved', variant: 'success' },
  dismissed: { label: 'log.status.dismissed', variant: 'outline' },
};

const SEVERITY_META: Record<
  ImprovementSeverity,
  { label: MessageKey; dot: string }
> = {
  low: { label: 'log.severity.low', dot: 'bg-content-disabled' },
  medium: { label: 'log.severity.medium', dot: 'bg-warning' },
  high: { label: 'log.severity.high', dot: 'bg-destructive' },
};

const KIND_FILTERS: { value: KindFilter; label: MessageKey }[] = [
  { value: 'all', label: 'log.filter.allKinds' },
  { value: 'issue', label: 'log.filter.issues' },
  { value: 'friction', label: 'log.filter.friction' },
  { value: 'idea', label: 'log.filter.ideas' },
  { value: 'win', label: 'log.filter.wins' },
];

const STATUS_FILTERS: { value: StatusFilter; label: MessageKey }[] = [
  { value: 'active', label: 'log.filter.active' },
  { value: 'done', label: 'log.filter.done' },
  { value: 'all', label: 'log.filter.all' },
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
  if (seconds < 45) return t('ago.justNow');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('ago.m', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('ago.h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('ago.d', { n: days });
  return iso.slice(0, 10);
}

function scopeLabel(scopes: ScopeInfo[], scopeId: string): string {
  return scopes.find((scope) => scope.id === scopeId)?.name ?? scopeId;
}

function sourceLabel(entry: ImprovementSummary): string {
  if (entry.source === 'user') return t('log.source.you');
  if (entry.source === 'chief') return t('log.source.chief');
  return t('log.source.system');
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
  const t = useT();
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
          {t('log.promote')}
        </Button>
      )}
      {canClose && (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('log.resolve')}
            title={t('log.resolve')}
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
            aria-label={t('log.dismiss')}
            title={t('log.dismiss')}
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
          aria-label={t('log.reopen')}
          title={t('log.reopen')}
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
  const t = useT();
  const status = STATUS_META[entry.status];
  const severity = SEVERITY_META[entry.severity];
  const kind = KIND_META[entry.kind];
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={status.variant} size="sm" className="font-mono">
        {t(status.label)}
      </Badge>
      <span className="inline-flex items-center gap-1 font-mono text-[9.5px] text-content-disabled">
        <span className={`size-1.5 rounded-full ${severity.dot}`} />
        {t(severity.label)}
      </span>
      <Badge variant="outline" size="sm" className="font-mono">
        {scopeLabel(scopes, entry.scopeId)}
      </Badge>
      <span className="font-mono text-[9.5px] text-content-disabled">
        {t(kind.label)} · {sourceLabel(entry)}
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
  const t = useT();
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
                    ? t('common.loading')
                    : detail.trim() || t('log.noDetail')}
                </pre>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {entry.taskId != null && (
                    <MetaRef
                      label={t('log.meta.task')}
                      value={`#${entry.taskId}`}
                    />
                  )}
                  {entry.runId && (
                    <MetaRef label={t('log.meta.run')} value={entry.runId} />
                  )}
                  {entry.conversationId && (
                    <MetaRef
                      label={t('log.meta.conv')}
                      value={entry.conversationId}
                    />
                  )}
                  {entry.eventId && (
                    <MetaRef
                      label={t('log.meta.event')}
                      value={entry.eventId}
                    />
                  )}
                  {entry.fingerprint && (
                    <MetaRef
                      label={t('log.meta.fp')}
                      value={entry.fingerprint}
                    />
                  )}
                  <MetaRef
                    label={t('log.meta.first')}
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
  const id = useId();
  const scopes = useStore((s) => s.scopes);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const [kind, setKind] = useState<ImprovementKind>('issue');
  const [severity, setSeverity] = useState<ImprovementSeverity>('medium');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [seed, setSeed] = useState('');
  const t = useT();
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
          <DialogTitle>{t('log.dialog.title')}</DialogTitle>
          <DialogDescription>{t('log.dialog.desc')}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 font-medium text-[11px] text-content-secondary">
              {t('log.dialog.kind')}
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
                    {t(meta.label)}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5" htmlFor={`${id}-summary`}>
            <span className="font-medium text-[11px] text-content-secondary">
              {t('log.dialog.summary')}
            </span>
            <Input
              id={`${id}-summary`}
              value={summary}
              maxLength={300}
              placeholder={t('log.dialog.summaryPlaceholder')}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5" htmlFor={`${id}-detail`}>
            <span className="font-medium text-[11px] text-content-secondary">
              {t('log.dialog.detail')}
            </span>
            <Textarea
              id={`${id}-detail`}
              value={detail}
              maxLength={20_000}
              placeholder={t('log.dialog.detailPlaceholder')}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 font-medium text-[11px] text-content-secondary">
              {t('log.dialog.severity')}
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
                    {t(SEVERITY_META[value].label)}
                  </Button>
                ),
              )}
            </div>
          </fieldset>
          <p className="font-mono text-[9.5px] text-content-disabled">
            {t('log.dialog.addingTo', { scope: label })}
          </p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            {t('common.cancel')}
          </DialogClose>
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
            {t('log.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * The triage surface for product observations and automatically caught
 * issues. Rendered inside Settings, so it owns no page chrome or scroll area.
 */
export function ImprovementLog() {
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
  const t = useT();

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
    <div
      role="group"
      aria-label={t('log.title')}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {STATUS_FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}
            >
              {t(filter.label)}
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
        <Button
          variant="outline"
          size="sm"
          className="ms-auto"
          onClick={() => setDialogOpen(true)}
        >
          <Plus size={12} />
          {t('log.newEntry')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <FilterChip active={allScopes} onClick={() => setAllScopes(true)}>
            {t('common.allScopes')}
          </FilterChip>
          <FilterChip active={!allScopes} onClick={() => setAllScopes(false)}>
            {scopeLabel(scopes, activeScopeId)}
          </FilterChip>
        </div>
        <div className="ms-auto flex items-baseline gap-3 font-mono text-[10px] text-content-disabled">
          <span>{t('log.openCount', { count: open })}</span>
          <span>{t('log.promotedCount', { count: promoted })}</span>
          <span>{t('log.totalCount', { count: improvements.length })}</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-content-secondary">
            <Notebook size={16} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-[13px] text-foreground">
              {t(improvements.length === 0 ? 'log.empty' : 'log.noMatch')}
            </p>
            <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
              {t(
                improvements.length === 0 ? 'log.emptyHint' : 'log.noMatchHint',
              )}
            </p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus size={12} />
            {t('log.newEntry')}
          </Button>
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.status}
            aria-label={t('log.sectionAria', {
              label: t(STATUS_META[group.status].label),
            })}
          >
            <SectionLabel
              label={t(STATUS_META[group.status].label)}
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

      <NewEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
