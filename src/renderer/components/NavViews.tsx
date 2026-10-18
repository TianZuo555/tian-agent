import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  ChatCircleText,
  Clock,
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
  TaskItem,
  TaskStatus,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { EASE } from './motion-primitives';
import { BrandOrb } from './BrandMark';

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
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur-md [-webkit-app-region:drag]">
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
      {action && (
        <div className="ml-auto [-webkit-app-region:no-drag]">{action}</div>
      )}
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

const goalBadge: Record<GoalStatus, 'outline' | 'warning' | 'secondary'> = {
  active: 'secondary',
  paused: 'outline',
  blocked: 'warning',
  completed: 'secondary',
  cancelled: 'outline',
};

const goalStatusText: Record<GoalStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const goalDot: Record<GoalStatus, string> = {
  active: 'bg-foreground',
  paused: 'bg-content-disabled',
  blocked: 'bg-warning',
  completed: 'bg-content-secondary',
  cancelled: 'bg-content-disabled/60',
};

const taskStatusText: Record<TaskStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  waiting_approval: 'Waiting approval',
  blocked: 'Blocked',
  failed: 'Failed',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
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
  return `next ${nextFireAt.slice(5, 16).replace('T', ' ')}`;
}

function GoalForm(props: {
  open: boolean;
  goal: GoalItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, goal, onOpenChange } = props;
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
            {goal ? 'Edit goal' : 'New goal'}
          </DialogTitle>
          <DialogDescription>
            A goal is an outcome to reach or keep over time. The chief splits it
            into tasks and reports progress.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Input
            placeholder="Objective: e.g. check tian-agent CI every morning"
            aria-label="Objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <Input
            placeholder="Success criteria (optional): e.g. green for 7 days"
            aria-label="Success criteria"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          <Input
            placeholder="Constraints (optional): e.g. read-only, no issues"
            aria-label="Constraints"
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
          <label
            className="flex items-center gap-2 font-mono text-[10px] text-content-secondary"
            htmlFor={budgetId}
          >
            Daily run budget
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
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={!objective.trim()}>
            {goal ? 'Save' : 'Create goal'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ScheduleRow({ goal }: { goal: GoalItem }) {
  const [adding, setAdding] = useState(false);
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
            aria-label="Remove schedule"
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
            placeholder="cron expression, e.g. 30 9 * * *"
            aria-label="Cron expression"
            size="sm"
            className="font-mono text-[11px]"
          />
          <Button type="submit" size="sm" variant="outline">
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="h-6 self-start gap-1 px-1.5 font-mono text-[10px] text-content-disabled hover:text-content-secondary"
          onClick={() => setAdding(true)}
        >
          <Plus size={10} /> Schedule
        </Button>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  progress,
  onEdit,
  reduce,
  index,
}: {
  goal: GoalItem;
  progress: { done: number; total: number } | undefined;
  onEdit: (goal: GoalItem) => void;
  reduce: boolean | null;
  index: number;
}) {
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
          {goalStatusText[goal.status]}
        </Badge>
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
              last run {goal.lastExecution.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-content-secondary opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Run now"
                  onClick={() => void actions.runGoalNow(goal.id)}
                />
              }
            >
              <Play size={13} weight="fill" className="text-brand" />
            </TooltipTrigger>
            <TooltipPopup>Run now</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    goal.status === 'paused' ? 'Resume goal' : 'Pause goal'
                  }
                  onClick={() =>
                    void actions.setGoalStatus(
                      goal.id,
                      goal.status === 'paused' ? 'active' : 'paused',
                    )
                  }
                />
              }
            >
              {goal.status === 'paused' ? (
                <Play size={13} />
              ) : (
                <Pause size={13} weight="fill" />
              )}
            </TooltipTrigger>
            <TooltipPopup>
              {goal.status === 'paused' ? 'Resume' : 'Pause'}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Edit goal"
                  onClick={() => onEdit(goal)}
                />
              }
            >
              <PencilSimple size={13} />
            </TooltipTrigger>
            <TooltipPopup>Edit</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Cancel goal"
                  className="hover:text-destructive-foreground"
                  onClick={() =>
                    void actions.setGoalStatus(goal.id, 'cancelled')
                  }
                />
              }
            >
              <X size={13} />
            </TooltipTrigger>
            <TooltipPopup>Cancel goal</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {open && (
        <div className="mt-2.5 pl-[4.25rem]">
          {pct !== null && (
            <div className="mb-2 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className="h-full rounded-full bg-brand-gradient"
                />
              </div>
              <span className="font-mono text-[9.5px] text-content-disabled tabular-nums">
                {progress!.done}/{progress!.total} tasks
              </span>
            </div>
          )}
          <ScheduleRow goal={goal} />
        </div>
      )}
    </motion.li>
  );
}

const TASK_GROUPS: { key: TaskStatus; label: string }[] = (
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

function TaskList({ tasks }: { tasks: TaskItem[] }) {
  const reduce = useReducedMotion();
  const groups = TASK_GROUPS.map((group) => ({
    ...group,
    items: tasks.filter((t) => t.status === group.key),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0)
    return (
      <p className="py-2 text-[12px] text-content-disabled">
        No tasks yet. Add one above or let the chief create them.
      </p>
    );
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <SectionLabel
            label={group.label}
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
              {group.items.map((t) => (
                <motion.li
                  key={t.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="group flex items-start gap-2.5 overflow-hidden rounded-lg px-2 py-2 transition-colors hover:bg-secondary"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={t.status === 'completed'}
                    disabled={
                      t.status !== 'pending' && t.status !== 'completed'
                    }
                    onCheckedChange={(checked) =>
                      void actions.toggleTask(t.id, checked === true)
                    }
                    aria-label={`Task: ${t.title}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 shrink-0 rounded-full ${taskStatusTone[t.status]}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] leading-snug transition-colors ${
                          t.status === 'completed'
                            ? 'text-content-disabled line-through'
                            : 'text-foreground'
                        }`}
                      >
                        {t.title}
                      </span>
                      {t.goalId && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="shrink-0 gap-1 font-mono"
                        >
                          <Target size={9} />
                          Goal
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-content-disabled">
                      <span className="truncate">{t.scopeId}</span>
                      {t.due && (
                        <span className="ml-auto shrink-0">
                          due {t.due.slice(0, 10)}
                        </span>
                      )}
                    </span>
                  </span>
                  <AnimatePresence>
                    {t.status === 'completed' && (
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
  const [draft, setDraft] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GoalItem | null>(null);
  const reduce = useReducedMotion();

  const openGoals = useMemo(
    () => goals.filter((g) => !['completed', 'cancelled'].includes(g.status)),
    [goals],
  );
  const closedGoals = useMemo(
    () => goals.filter((g) => ['completed', 'cancelled'].includes(g.status)),
    [goals],
  );
  const pending = tasks.filter((t) => t.status === 'pending').length;
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
      aria-label="Goals"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={Target}
        title="Goals"
        meta={`${openGoals.length} active · ${pending} pending`}
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New goal"
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
              aria-label="New conversation"
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
          <form
            className="group mb-7 flex items-center gap-2 rounded-xl border border-border bg-card/60 p-1.5 pl-3 transition-colors focus-within:border-border-secondary"
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
              placeholder="Add a task…"
              aria-label="New task"
              unstyled
              className="h-6 text-[13px]"
            />
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Add task"
              disabled={!draft.trim()}
            >
              <ArrowRight size={13} />
            </Button>
          </form>

          {openGoals.length === 0 && closedGoals.length === 0 && (
            <div className="relative mx-auto flex max-w-md flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-border px-6 py-14 text-center">
              <div className="ambient-glow pointer-events-none absolute inset-0 opacity-60" />
              <div className="relative scale-75">
                <BrandOrb />
              </div>
              <div className="relative flex flex-col items-center gap-1">
                <p className="text-[13px] text-foreground">No goals yet.</p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  Give the chief something long-running to keep moving.
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
                New goal
              </Button>
            </div>
          )}

          {openGoals.length > 0 && (
            <section aria-label="Open goals" className="mb-8">
              <SectionLabel
                label="Goals"
                count={openGoals.length}
                tone="brand"
              />
              <ul className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {openGoals.map((goal, i) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      index={i}
                      progress={progressByGoal.get(goal.id)}
                      reduce={reduce}
                      onEdit={(g) => {
                        setEditing(g);
                        setDialogOpen(true);
                      }}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          )}

          {notices.length > 0 && (
            <section aria-label="Notices" className="mb-8">
              <SectionLabel
                label="Notices"
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
                        <span className="truncate font-mono text-[9.5px] text-content-disabled">
                          {n.fingerprint}
                        </span>
                        {!n.deliveredAt && (
                          <Badge variant="info" size="sm" className="font-mono">
                            new
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

          {closedGoals.length > 0 && (
            <section aria-label="Closed goals" className="mb-8">
              <SectionLabel label="Closed" count={closedGoals.length} />
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
                      {goalStatusText[goal.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-content-secondary line-through decoration-border-secondary">
                      {goal.objective}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Resume goal"
                      title="Resume"
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

          <section aria-label="Tasks">
            <SectionLabel label="Tasks" count={tasks.length} />
            <TaskList tasks={tasks} />
          </section>
        </div>
      </ScrollArea>

      <GoalForm open={dialogOpen} goal={editing} onOpenChange={setDialogOpen} />
    </main>
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
  const reduce = useReducedMotion();
  const unread = inbox.filter((m) => !m.read).length;

  return (
    <main
      aria-label="Inbox"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={Tray}
        title="Inbox"
        meta={`${unread} unread · ${inbox.length} total`}
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
                <p className="text-[13px] text-foreground">Inbox zero.</p>
                <p className="max-w-xs text-[12px] text-content-secondary leading-relaxed">
                  Messages from agents, runs, and other channels land here.
                </p>
              </div>
            </div>
          ) : (
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
                            new
                          </Badge>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[9.5px] text-content-disabled">
                          {m.ts.slice(5, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-[13px] text-content-secondary leading-relaxed">
                        {m.body}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}
