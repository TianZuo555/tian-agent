import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowRight,
  CalendarCheck,
  CaretRight,
  CheckCircle,
  ChatCircleText,
  Clock,
  Lightning,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Pulse,
  Target,
  Trash,
  Tray,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import type {
  GoalItem,
  GoalStatus,
  InboxItem,
  SkillItem,
  SkillStatus,
  TaskItem,
  TaskStatus,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { t, useT, type MessageKey } from '../i18n';
import { EASE } from './motion-primitives';
import { Markdown } from './Markdown';
import { ContextToggle, SidebarToggle } from './SidebarToggle';
import { PaneHeader } from './PaneHeader';

function Header({
  icon: IconComponent,
  title,
  meta,
  action,
}: {
  icon: Icon;
  title: string;
  meta: string;
  action?: React.ReactNode;
}) {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const contextOpen = useStore((s) => s.contextOpen);
  return (
    // A folded sidebar leaves the traffic lights over this row's left.
    <PaneHeader
      clearance={!sidebarOpen}
      className="bg-background/80 backdrop-blur-md"
    >
      <SidebarToggle />
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary"
      >
        <IconComponent size={12} />
      </span>
      <h1 className="font-medium text-[13px]">{title}</h1>
      <span className="font-mono text-[9.5px] text-content-disabled">
        {meta}
      </span>
      <div className="ml-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
        {action}
        {/* The open context pane carries its own toggle at the same seam. */}
        {!contextOpen && <ContextToggle />}
      </div>
    </PaneHeader>
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

const goalBadge: Record<GoalStatus, 'outline' | 'warning' | 'secondary'> = {
  active: 'secondary',
  paused: 'outline',
  blocked: 'warning',
  completed: 'secondary',
  cancelled: 'outline',
};

const goalStatusText: Record<GoalStatus, MessageKey> = {
  active: 'goal.status.active',
  paused: 'goal.status.paused',
  blocked: 'goal.status.blocked',
  completed: 'goal.status.completed',
  cancelled: 'goal.status.cancelled',
};

const goalDot: Record<GoalStatus, string> = {
  active: 'bg-foreground',
  paused: 'bg-content-disabled',
  blocked: 'bg-warning',
  completed: 'bg-content-secondary',
  cancelled: 'bg-content-disabled/60',
};

const taskStatusText: Record<TaskStatus, MessageKey> = {
  pending: 'task.status.pending',
  running: 'task.status.running',
  waiting_approval: 'task.status.waiting_approval',
  blocked: 'task.status.blocked',
  failed: 'task.status.failed',
  paused: 'task.status.paused',
  completed: 'task.status.completed',
  cancelled: 'task.status.cancelled',
};

const taskStatusTone: Record<TaskStatus, string> = {
  pending: 'bg-content-disabled/60',
  running: 'bg-foreground',
  waiting_approval: 'bg-warning',
  blocked: 'bg-warning',
  failed: 'bg-destructive',
  paused: 'bg-content-disabled/60',
  completed: 'bg-content-secondary',
  cancelled: 'bg-content-disabled/40',
};

function scheduleLine(nextFireAt: string | null): string {
  if (!nextFireAt) return '';
  return t('goal.nextRun', {
    time: nextFireAt.slice(5, 16).replace('T', ' '),
  });
}

function GoalForm(props: {
  open: boolean;
  goal: GoalItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, goal, onOpenChange } = props;
  const t = useT();
  const budgetId = useId();
  const [objective, setObjective] = useState('');
  const [criteria, setCriteria] = useState('');
  const [constraints, setConstraints] = useState('');
  const [budget, setBudget] = useState('3');
  const [key, setKey] = useState('');
  // Re-seed the fields whenever the dialog opens for another goal.
  const seed = `${open ? 'open' : 'closed'}:${goal?.id ?? 'new'}`;
  if (seed !== key) {
    setKey(seed);
    setObjective(goal?.objective ?? '');
    setCriteria(goal?.successCriteria ?? '');
    setConstraints(goal?.constraints ?? '');
    setBudget(String(goal?.maxRunsPerDay ?? 3));
  }
  const submit = async () => {
    if (!objective.trim()) return;
    const max = Math.max(1, Math.min(48, Number(budget) || 3));
    if (goal)
      await actions.updateGoal(goal.id, {
        objective: objective.trim(),
        successCriteria: criteria.trim(),
        constraints: constraints.trim(),
        maxRunsPerDay: max,
      });
    else
      await actions.createGoal(
        objective.trim(),
        criteria.trim(),
        constraints.trim(),
        max,
      );
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand/12 text-brand">
              <Target size={15} />
            </span>
            {goal ? t('goal.form.edit') : t('goals.new')}
          </DialogTitle>
          <DialogDescription>{t('goal.form.desc')}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Input
            placeholder={t('goal.form.objectivePlaceholder')}
            aria-label={t('goal.form.objective')}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <Input
            placeholder={t('goal.form.criteriaPlaceholder')}
            aria-label={t('goal.form.criteria')}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          <Input
            placeholder={t('goal.form.constraintsPlaceholder')}
            aria-label={t('goal.form.constraints')}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
          <label
            className="flex items-center gap-2 font-mono text-[10px] text-content-secondary"
            htmlFor={budgetId}
          >
            {t('goal.form.budget')}
            <Input
              id={budgetId}
              type="number"
              min={1}
              max={48}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              size="sm"
              className="w-20"
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            {t('common.cancel')}
          </DialogClose>
          <Button onClick={submit} disabled={!objective.trim()}>
            {goal ? t('common.save') : t('goal.form.create')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ScheduleRow({ goal }: { goal: GoalItem }) {
  const [adding, setAdding] = useState(false);
  const t = useT();
  const [cron, setCron] = useState('');
  const cronRef = useRef<HTMLInputElement>(null);
  // Move focus to the cron field once the inline form is inserted; unlike the
  // autoFocus attribute this also works for content added after first paint.
  useEffect(() => {
    if (adding) cronRef.current?.focus();
  }, [adding]);
  return (
    <div className="flex flex-col gap-1">
      {goal.schedules.map((s) => (
        <div
          key={s.id}
          className="group flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-2 py-1"
        >
          <Clock size={11} className="shrink-0 text-content-disabled" />
          <span className="truncate font-mono text-[10px] text-content-secondary">
            {s.cron} · {s.timezone}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-content-disabled">
            {scheduleLine(s.nextFireAt)}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('goal.removeSchedule')}
            className="size-5 text-content-disabled opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive-foreground"
            onClick={() => void actions.removeSchedule(s.id)}
          >
            <Trash size={10} />
          </Button>
        </div>
      ))}
      {adding ? (
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!cron.trim()) return;
            await actions.addSchedule(goal.id, cron.trim(), null);
            setCron('');
            setAdding(false);
          }}
        >
          <Input
            ref={cronRef}
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder={t('goal.cronPlaceholder')}
            aria-label={t('goal.cronAria')}
            size="sm"
            className="font-mono text-[11px]"
          />
          <Button type="submit" size="sm" variant="outline">
            {t('common.add')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
          >
            {t('common.cancel')}
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="h-6 self-start gap-1 px-1.5 font-mono text-[10px] text-content-disabled hover:text-content-secondary"
          onClick={() => setAdding(true)}
        >
          <Plus size={10} /> {t('goal.schedule')}
        </Button>
      )}
    </div>
  );
}

/** Hover-revealed run/pause/edit/cancel cluster on a goal card. */
function GoalActions({
  goal,
  onEdit,
}: {
  goal: GoalItem;
  onEdit: (goal: GoalItem) => void;
}) {
  const t = useT();
  const paused = goal.status === 'paused';
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-content-secondary opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('goal.runNow')}
              onClick={() => void actions.runGoalNow(goal.id)}
            />
          }
        >
          <Play size={13} weight="fill" className="text-brand" />
        </TooltipTrigger>
        <TooltipPopup>{t('goal.runNow')}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t(paused ? 'goal.resumeAria' : 'goal.pauseAria')}
              onClick={() =>
                void actions.setGoalStatus(
                  goal.id,
                  paused ? 'active' : 'paused',
                )
              }
            />
          }
        >
          {paused ? <Play size={13} /> : <Pause size={13} weight="fill" />}
        </TooltipTrigger>
        <TooltipPopup>{t(paused ? 'goals.resume' : 'goal.pause')}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('goal.editAria')}
              onClick={() => onEdit(goal)}
            />
          }
        >
          <PencilSimple size={13} />
        </TooltipTrigger>
        <TooltipPopup>{t('goal.edit')}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('goal.cancel')}
              className="hover:text-destructive-foreground"
              onClick={() => void actions.setGoalStatus(goal.id, 'cancelled')}
            />
          }
        >
          <X size={13} />
        </TooltipTrigger>
        <TooltipPopup>{t('goal.cancel')}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function GoalCard({
  goal,
  progress,
  onEdit,
  reduce,
  index,
  scope,
}: {
  goal: GoalItem;
  progress: { done: number; total: number } | undefined;
  onEdit: (goal: GoalItem) => void;
  reduce: boolean | null;
  index: number;
  /** Scope display name; omitted when the app has a single scope. */
  scope?: string;
}) {
  const t = useT();
  const open = goal.status === 'active';
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, height: 0 }}
      transition={{
        duration: 0.24,
        ease: EASE,
        delay: reduce ? 0 : index * 0.04,
      }}
      className="card-hover group relative overflow-hidden rounded-xl border border-border bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <Badge
          variant={goalBadge[goal.status]}
          size="sm"
          className="mt-0.5 shrink-0 gap-1 font-mono"
        >
          <span className={`size-1 rounded-full ${goalDot[goal.status]}`} />
          {t(goalStatusText[goal.status])}
        </Badge>
        {scope && (
          <span className="mt-1 shrink-0 rounded-md border border-border px-1.5 py-px font-mono text-[9px] text-content-disabled">
            {scope}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] leading-snug">
            {goal.objective}
          </p>
          {goal.currentState && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-content-secondary leading-snug">
              <Pulse
                size={11}
                className="mt-1 shrink-0 text-content-disabled"
              />
              <span className="min-w-0">{goal.currentState}</span>
            </p>
          )}
          {goal.nextAction && (
            <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-content-secondary leading-snug">
              <ArrowRight
                size={11}
                className="mt-1 shrink-0 text-content-disabled"
              />
              <span className="min-w-0">{goal.nextAction}</span>
            </p>
          )}
          {goal.lastExecution && (
            <p className="mt-1 truncate font-mono text-[9.5px] text-content-disabled">
              {t('goal.lastRun', {
                time: goal.lastExecution.slice(0, 16).replace('T', ' '),
              })}
            </p>
          )}
        </div>
        <GoalActions goal={goal} onEdit={onEdit} />
      </div>
      {open && (
        <div className="mt-2.5 pl-[4.25rem]">
          {pct !== null && (
            <div className="mb-2 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                {/* Full-width bar scaled from the left: transform-only, so
                    progress never triggers a layout pass. */}
                <motion.div
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className="h-full origin-left rounded-full bg-brand-gradient"
                />
              </div>
              <span className="font-mono text-[9.5px] text-content-disabled tabular-nums">
                {t('goal.tasksProgress', {
                  done: progress!.done,
                  total: progress!.total,
                })}
              </span>
            </div>
          )}
          <ScheduleRow goal={goal} />
        </div>
      )}
    </motion.li>
  );
}

const TASK_GROUPS: { key: TaskStatus; label: MessageKey }[] = (
  [
    'pending',
    'running',
    'waiting_approval',
    'blocked',
    'failed',
    'paused',
    'completed',
  ] as TaskStatus[]
).map((key) => ({ key, label: taskStatusText[key] }));

function TaskList({
  tasks,
  scopeLabel,
}: {
  tasks: TaskItem[];
  /** Resolves a scope id to a display name; '' hides the scope entirely. */
  scopeLabel: (id: string) => string;
}) {
  const reduce = useReducedMotion();
  const t = useT();
  const groups = TASK_GROUPS.map((group) => ({
    ...group,
    items: tasks.filter((t) => t.status === group.key),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0)
    return (
      <p className="py-2 text-[12px] text-content-disabled">
        {t('goals.noTasks')}
      </p>
    );
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={t(group.label)}>
          <SectionLabel
            label={t(group.label)}
            count={group.items.length}
            tone={
              group.key === 'completed'
                ? 'success'
                : group.key === 'running'
                  ? 'brand'
                  : group.key === 'failed'
                    ? 'warning'
                    : 'neutral'
            }
          />
          <ul className="flex flex-col">
            <AnimatePresence initial={false}>
              {group.items.map((task) => (
                <motion.li
                  key={task.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="group flex items-start gap-2.5 overflow-hidden rounded-lg px-2 py-2 transition-colors hover:bg-secondary"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={task.status === 'completed'}
                    disabled={
                      task.status !== 'pending' && task.status !== 'completed'
                    }
                    onCheckedChange={(checked) =>
                      void actions.toggleTask(task.id, checked === true)
                    }
                    aria-label={t('context.taskLabel', { title: task.title })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 shrink-0 rounded-full ${taskStatusTone[task.status]}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] leading-snug transition-colors ${
                          task.status === 'completed'
                            ? 'text-content-disabled line-through'
                            : 'text-foreground'
                        }`}
                      >
                        {task.title}
                      </span>
                      {task.goalId && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1 font-mono"
                        >
                          <Target size={9} />
                          {t('goal.badge')}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-content-disabled">
                      <span className="truncate">
                        {scopeLabel(task.scopeId)}
                      </span>
                      {task.due && (
                        <span className="ml-auto shrink-0">
                          {t('goal.due', { date: task.due.slice(0, 10) })}
                        </span>
                      )}
                    </span>
                  </span>
                  <AnimatePresence>
                    {task.status === 'completed' && (
                      <motion.span
                        initial={reduce ? false : { scale: 0, rotate: -30 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 22,
                        }}
                      >
                        <CheckCircle
                          size={14}
                          weight="fill"
                          className="mt-1 shrink-0 text-content-secondary"
                        />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}
    </div>
  );
}

export function GoalsView() {
  const goals = useStore((s) => s.goals);
  const tasks = useStore((s) => s.tasks);
  const notices = useStore((s) => s.notices);
  const scopes = useStore((s) => s.scopes);
  const [draft, setDraft] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GoalItem | null>(null);
  const reduce = useReducedMotion();
  const t = useT();

  const openGoals = useMemo(
    () => goals.filter((g) => !['completed', 'cancelled'].includes(g.status)),
    [goals],
  );
  const closedGoals = useMemo(
    () => goals.filter((g) => ['completed', 'cancelled'].includes(g.status)),
    [goals],
  );
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const scopeName = (id: string) =>
    scopes.find((scope) => scope.id === id)?.name ?? id;
  // Scope labels only earn their pixels when scopes actually differ.
  const scopeLabel = (id: string) => (scopes.length > 1 ? scopeName(id) : '');
  const progressByGoal = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const task of tasks) {
      if (!task.goalId) continue;
      const entry = map.get(task.goalId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (task.status === 'completed') entry.done += 1;
      map.set(task.goalId, entry);
    }
    return map;
  }, [tasks]);

  return (
    <main
      aria-label={t('goals.aria')}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={Target}
        title={t('nav.goals')}
        meta={t('goals.meta', { open: openGoals.length, pending })}
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('goals.new')}
              className="text-content-secondary"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus size={15} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.newConversation')}
              className="text-content-secondary"
              onClick={() => {
                actions.setNav('chat');
                void actions.newConversation('global');
              }}
            >
              <ChatCircleText size={15} />
            </Button>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {goals.length === 0 ? (
            <div className="relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-border px-6 py-16 text-center">
              <div className="ambient-glow pointer-events-none absolute inset-0 opacity-50" />
              <span className="relative flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-brand">
                <Target size={19} weight="duotone" />
              </span>
              <div className="relative flex flex-col items-center gap-1">
                <p className="text-[13px] text-foreground">
                  {t('goals.empty.title')}
                </p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  {t('goals.empty.hint')}
                </p>
              </div>
              <Button
                size="sm"
                className="relative"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus size={13} />
                {t('goals.new')}
              </Button>
            </div>
          ) : (
            <section aria-label={t('goals.openSection')} className="mb-8">
              <SectionLabel
                label={t('nav.goals')}
                count={openGoals.length}
                tone="brand"
              />
              {openGoals.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  <AnimatePresence initial={false}>
                    {openGoals.map((goal, i) => (
                      <GoalCard
                        key={goal.id}
                        goal={goal}
                        index={i}
                        progress={progressByGoal.get(goal.id)}
                        reduce={reduce}
                        scope={
                          scopes.length > 1
                            ? scopeName(goal.scopeId)
                            : undefined
                        }
                        onEdit={(g) => {
                          setEditing(g);
                          setDialogOpen(true);
                        }}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              ) : (
                <p className="mb-2 py-1 text-[12px] text-content-disabled">
                  {t('goals.noneActive')}
                </p>
              )}
              {/* The in-list affordance: quiet until it earns a look. */}
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
                className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-[12px] text-content-disabled transition-colors hover:border-border-secondary hover:bg-card/50 hover:text-content-secondary"
              >
                <Plus size={12} />
                {t('goals.new')}
              </button>
            </section>
          )}

          {notices.length > 0 && (
            <section aria-label={t('goals.noticesSection')} className="mb-8">
              <SectionLabel
                label={t('goals.notices')}
                count={notices.length}
                tone="warning"
              />
              <ul className="flex flex-col gap-1.5">
                {notices.slice(0, 10).map((n) => (
                  <motion.li
                    key={n.id}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
                      n.deliveredAt
                        ? 'border-border bg-card'
                        : 'border-border-sky/50 bg-surface-sky/15'
                    }`}
                  >
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-tertiary text-content-secondary">
                      <CalendarCheck size={11} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {scopeLabel(n.scopeId) && (
                          <span className="shrink-0 rounded-md border border-border px-1.5 py-px font-mono text-[9px] text-content-disabled">
                            {scopeLabel(n.scopeId)}
                          </span>
                        )}
                        <span className="truncate font-mono text-[9.5px] text-content-disabled">
                          {n.fingerprint}
                        </span>
                        {!n.deliveredAt && (
                          <Badge variant="info" size="sm" className="font-mono">
                            {t('common.new')}
                          </Badge>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[9.5px] text-content-disabled">
                          {n.createdAt.slice(5, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <p className="mt-0.5 break-words text-[12px] text-content-secondary leading-snug">
                        {n.text}
                      </p>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label={t('goals.tasksSection')} className="mb-8">
            <SectionLabel label={t('context.tasks')} count={tasks.length} />
            {/* The add-row sits with its output: a dashed row on top of the
                list, styled like the rows that land under it. */}
            <form
              className="group mb-1.5 flex items-center gap-2.5 rounded-lg border border-dashed border-border px-2.5 py-1 transition-colors focus-within:border-border-secondary focus-within:bg-card/60 hover:bg-card/40"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                await actions.addTask(draft.trim());
                setDraft('');
              }}
            >
              <Plus
                size={12}
                className="shrink-0 text-content-disabled transition-transform duration-200 group-focus-within:rotate-90 group-focus-within:text-brand"
              />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('context.addTask')}
                aria-label={t('context.newTaskTitle')}
                unstyled
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon-xs"
                aria-label={t('context.addTaskAria')}
                disabled={!draft.trim()}
                className="shrink-0 text-content-secondary"
              >
                <ArrowRight size={12} />
              </Button>
            </form>
            <TaskList tasks={tasks} scopeLabel={scopeLabel} />
          </section>

          {closedGoals.length > 0 && (
            <section aria-label={t('goals.closedSection')} className="mb-8">
              <SectionLabel
                label={t('goals.closed')}
                count={closedGoals.length}
              />
              <ul className="flex flex-col gap-0.5">
                {closedGoals.map((goal) => (
                  <li
                    key={goal.id}
                    className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary"
                  >
                    <Badge
                      variant={goalBadge[goal.status]}
                      size="sm"
                      className="shrink-0 font-mono"
                    >
                      {t(goalStatusText[goal.status])}
                    </Badge>
                    {scopes.length > 1 && (
                      <span className="shrink-0 font-mono text-[9px] text-content-disabled">
                        {scopeName(goal.scopeId)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-content-secondary line-through decoration-border-secondary">
                      {goal.objective}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('goals.resumeAria')}
                      title={t('goals.resume')}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      onClick={() =>
                        void actions.setGoalStatus(goal.id, 'active')
                      }
                    >
                      <Play size={11} />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>

      <GoalForm open={dialogOpen} goal={editing} onOpenChange={setDialogOpen} />
    </main>
  );
}

/** Inbox rows; a keyed motion list so reads and arrivals animate in place. */
function InboxList({
  inbox,
  reduce,
  scopeLabel,
}: {
  inbox: InboxItem[];
  reduce: boolean;
  scopeLabel: (id: string) => string;
}) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {inbox.map((m, i) => {
          const MsgIcon = inboxIcon(m.from);
          return (
            <motion.li
              key={m.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{
                duration: 0.22,
                ease: EASE,
                delay: reduce ? 0 : Math.min(i, 8) * 0.03,
              }}
              className={`card-hover group relative overflow-hidden rounded-xl border px-3.5 py-3 ${
                m.read
                  ? 'border-border bg-card'
                  : 'border-border-sky/50 bg-surface-sky/15'
              }`}
            >
              {!m.read && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-info"
                />
              )}
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary">
                  <MsgIcon size={11} />
                </span>
                <span className="truncate font-medium text-[12px]">
                  {m.from}
                </span>
                {m.to && (
                  <span className="truncate font-mono text-[9.5px] text-content-disabled">
                    → {m.to}
                  </span>
                )}
                {!m.read && (
                  <Badge variant="info" size="sm" className="font-mono">
                    {t('common.new')}
                  </Badge>
                )}
                {scopeLabel(m.scopeId) && (
                  <span className="shrink-0 rounded-md border border-border px-1.5 py-px font-mono text-[9px] text-content-disabled">
                    {scopeLabel(m.scopeId)}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-content-disabled">
                  {m.ts.slice(5, 16).replace('T', ' ')}
                </span>
              </div>
              <Markdown
                text={m.body}
                className="text-[12.5px] text-content-secondary"
              />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

function inboxIcon(from: string): Icon {
  if (/telegram/i.test(from)) return ChatCircleText;
  if (/goal|chief|agent/i.test(from)) return Target;
  if (/run|worker/i.test(from)) return Play;
  return Tray;
}

export function InboxView() {
  const inbox = useStore((s) => s.inbox);
  const scopes = useStore((s) => s.scopes);
  const reduce = useReducedMotion();
  const t = useT();
  const unread = inbox.filter((m) => !m.read).length;
  const scopeLabel = (id: string) =>
    scopes.length > 1
      ? (scopes.find((scope) => scope.id === id)?.name ?? id)
      : '';

  return (
    <main
      aria-label={t('inbox.aria')}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={Tray}
        title={t('nav.inbox')}
        meta={t('inbox.meta', { unread, total: inbox.length })}
      />
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {inbox.length === 0 ? (
            <div className="relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-border px-6 py-16 text-center">
              <div className="ambient-glow pointer-events-none absolute inset-0 opacity-50" />
              <span className="relative flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-content-disabled">
                <Tray size={19} weight="duotone" />
              </span>
              <div className="relative flex flex-col items-center gap-1">
                <p className="text-[13px] text-foreground">
                  {t('inbox.empty.title')}
                </p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  {t('inbox.empty.hint')}
                </p>
              </div>
            </div>
          ) : (
            <InboxList
              inbox={inbox}
              reduce={Boolean(reduce)}
              scopeLabel={scopeLabel}
            />
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

const skillStatusText: Record<SkillStatus, MessageKey> = {
  candidate: 'skill.status.candidate',
  approved: 'skill.status.approved',
  retired: 'skill.status.retired',
  superseded: 'skill.status.superseded',
};

const skillStatusBadge: Record<
  SkillStatus,
  'warning' | 'success' | 'outline' | 'secondary'
> = {
  candidate: 'warning',
  approved: 'success',
  retired: 'outline',
  superseded: 'secondary',
};

/** Experience ≠ Verified Skill: verification is execution evidence, shown as-is. */
function VerificationBadge({ skill }: { skill: SkillItem }) {
  const t = useT();
  if (skill.verification === 'unverified') return null;
  return (
    <Badge
      variant={skill.verification === 'failed' ? 'error' : 'success'}
      size="sm"
      className="shrink-0 font-mono"
    >
      {t(
        skill.verification === 'failed' ? 'skill.failedRun' : 'skill.verified',
      )}
    </Badge>
  );
}

interface SkillGroup {
  scopeId: string;
  name: string;
  versions: SkillItem[];
  latest: SkillItem;
}

function groupSkills(skills: SkillItem[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const skill of skills) {
    const key = `${skill.scopeId}\u0000${skill.name}`;
    const group = groups.get(key) ?? {
      scopeId: skill.scopeId,
      name: skill.name,
      versions: [],
      latest: skill,
    };
    group.versions.push(skill);
    if (skill.version > group.latest.version) group.latest = skill;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function SkillVersionRow({ skill }: { skill: SkillItem }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary">
      <span className="shrink-0 font-mono text-[10px] text-content-disabled tabular-nums">
        v{skill.version}
      </span>
      <Badge
        variant={skillStatusBadge[skill.status]}
        size="sm"
        className="shrink-0 font-mono"
      >
        {t(skillStatusText[skill.status])}
      </Badge>
      <VerificationBadge skill={skill} />
      <span className="ml-auto shrink-0 truncate font-mono text-[9.5px] text-content-disabled">
        {skill.sourceRefs.join(' · ')}
      </span>
      {skill.status === 'approved' && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('skills.rollbackAria', { name: skill.name })}
                className="text-content-secondary hover:text-destructive-foreground"
                onClick={() => void actions.skillRollback(skill.id)}
              />
            }
          >
            <ArrowCounterClockwise size={12} />
          </TooltipTrigger>
          <TooltipPopup>{t('common.rollback')}</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}

function SkillCard({
  group,
  scopeName,
  index,
  reduce,
}: {
  group: SkillGroup;
  scopeName: string;
  index: number;
  reduce: boolean | null;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const latest = group.latest;
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, height: 0 }}
      transition={{
        duration: 0.24,
        ease: EASE,
        delay: reduce ? 0 : Math.min(index, 8) * 0.03,
      }}
      className="card-hover relative overflow-hidden rounded-xl border border-border bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand">
          <Lightning size={12} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] leading-snug">
              {group.name}
            </span>
            <Badge variant="outline" size="sm" className="shrink-0 font-mono">
              v{latest.version}
            </Badge>
            <Badge
              variant={skillStatusBadge[latest.status]}
              size="sm"
              className="shrink-0 font-mono"
            >
              {t(skillStatusText[latest.status])}
            </Badge>
            <VerificationBadge skill={latest} />
          </div>
          <p className="mt-1 break-words text-[12px] text-content-secondary leading-snug">
            {latest.description}
          </p>
          <p className="mt-1 truncate font-mono text-[9.5px] text-content-disabled">
            {scopeName} ·{' '}
            {t('skills.updated', {
              time: latest.updatedAt.slice(0, 16).replace('T', ' '),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {latest.status === 'candidate' && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('skills.approveAria', {
                        name: group.name,
                      })}
                      onClick={() => void actions.skillApprove(latest.id)}
                    />
                  }
                >
                  <CheckCircle
                    size={14}
                    weight="fill"
                    className="text-content-secondary"
                  />
                </TooltipTrigger>
                <TooltipPopup>{t('skills.approve')}</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('skills.dismissAria', {
                        name: group.name,
                      })}
                      className="hover:text-destructive-foreground"
                      onClick={() => void actions.skillRetire(latest.id)}
                    />
                  }
                >
                  <X size={14} />
                </TooltipTrigger>
                <TooltipPopup>{t('skills.dismiss')}</TooltipPopup>
              </Tooltip>
            </>
          )}
          {latest.status === 'approved' && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('skills.rollbackAria', {
                        name: group.name,
                      })}
                      className="hover:text-destructive-foreground"
                      onClick={() => void actions.skillRollback(latest.id)}
                    />
                  }
                >
                  <ArrowCounterClockwise size={14} />
                </TooltipTrigger>
                <TooltipPopup>{t('skills.rollbackFull')}</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('skills.retireAria', {
                        name: group.name,
                      })}
                      className="hover:text-destructive-foreground"
                      onClick={() => void actions.skillRetire(latest.id)}
                    />
                  }
                >
                  <X size={14} />
                </TooltipTrigger>
                <TooltipPopup>{t('skills.retire')}</TooltipPopup>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-2 flex cursor-pointer items-center gap-1 font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.1em] transition-colors hover:text-content-secondary"
      >
        <CaretRight
          size={9}
          weight="bold"
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        {t('skills.history', { count: group.versions.length })}
      </button>
      {open && (
        <div className="mt-1 flex flex-col border-border border-l pl-2">
          {[...group.versions].reverse().map((skill) => (
            <SkillVersionRow key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </motion.li>
  );
}

function SkillSection({
  label,
  tone,
  groups,
  scopeName,
  reduce,
  hint,
}: {
  label: string;
  tone: 'brand' | 'warning' | 'neutral';
  groups: SkillGroup[];
  scopeName: (id: string) => string;
  reduce: boolean | null;
  hint: string;
}) {
  if (groups.length === 0) return null;
  return (
    <section aria-label={label} className="mb-8">
      <SectionLabel label={label} count={groups.length} tone={tone} />
      <p className="mb-2 text-[11.5px] text-content-secondary">{hint}</p>
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {groups.map((group, i) => (
            <SkillCard
              key={`${group.scopeId}\u0000${group.name}`}
              group={group}
              scopeName={scopeName(group.scopeId)}
              index={i}
              reduce={reduce}
            />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

export function SkillsView() {
  const skills = useStore((s) => s.skills);
  const scopes = useStore((s) => s.scopes);
  const reduce = useReducedMotion();
  const t = useT();
  const scopeName = (id: string) =>
    scopes.find((scope) => scope.id === id)?.name ?? id;
  const groups = useMemo(() => groupSkills(skills), [skills]);
  const candidates = groups.filter((g) => g.latest.status === 'candidate');
  const approved = groups.filter((g) => g.latest.status === 'approved');
  const inactive = groups.filter((g) =>
    ['retired', 'superseded'].includes(g.latest.status),
  );

  return (
    <main
      aria-label={t('skills.aria')}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={Lightning}
        title={t('nav.skills')}
        meta={t('skills.meta', {
          approved: approved.length,
          candidates: candidates.length,
        })}
      />
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {groups.length === 0 && (
            <div className="relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-border px-6 py-16 text-center">
              <div className="ambient-glow pointer-events-none absolute inset-0 opacity-50" />
              <span className="relative flex size-11 items-center justify-center rounded-2xl border border-border bg-card text-content-disabled">
                <Lightning size={19} weight="duotone" />
              </span>
              <div className="relative flex flex-col items-center gap-1">
                <p className="text-[13px] text-foreground">
                  {t('skills.empty.title')}
                </p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  {t('skills.empty.hint')}
                </p>
              </div>
            </div>
          )}
          <SkillSection
            label={t('skills.candidates')}
            tone="warning"
            groups={candidates}
            scopeName={scopeName}
            reduce={reduce}
            hint={t('skills.candidatesHint')}
          />
          <SkillSection
            label={t('skills.approved')}
            tone="brand"
            groups={approved}
            scopeName={scopeName}
            reduce={reduce}
            hint={t('skills.approvedHint')}
          />
          <SkillSection
            label={t('skills.retired')}
            tone="neutral"
            groups={inactive}
            scopeName={scopeName}
            reduce={reduce}
            hint={t('skills.retiredHint')}
          />
        </div>
      </ScrollArea>
    </main>
  );
}
