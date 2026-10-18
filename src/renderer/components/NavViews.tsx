import { useMemo, useState } from 'react';
import {
  Check,
  Inbox as InboxIcon,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
  Trash2,
  X,
} from 'lucide-react';
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
import type {
  GoalItem,
  GoalStatus,
  TaskItem,
  TaskStatus,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { EASE } from './motion-primitives';

function Header({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon: typeof Target;
  title: string;
  meta: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-4 [-webkit-app-region:drag]">
      <Icon className="size-4 text-content-secondary" />
      <h1 className="font-medium text-[13px]">{title}</h1>
      <span className="font-mono text-[10px] text-content-disabled">
        {meta}
      </span>
      {action && (
        <div className="ml-auto [-webkit-app-region:no-drag]">{action}</div>
      )}
    </header>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h2 className="font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.09em]">
        {label}
      </h2>
      <span className="font-mono text-[10px] text-content-disabled/70 tabular-nums">
        {count}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const goalBadge: Record<
  GoalStatus,
  'success' | 'outline' | 'warning' | 'secondary'
> = {
  active: 'success',
  paused: 'outline',
  blocked: 'warning',
  completed: 'secondary',
  cancelled: 'outline',
};

const goalStatusText: Record<GoalStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  blocked: '受阻',
  completed: '已完成',
  cancelled: '已取消',
};

const taskStatusText: Record<TaskStatus, string> = {
  pending: '待处理',
  running: '运行中',
  waiting_approval: '待审批',
  blocked: '受阻',
  failed: '失败',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
};

function scheduleLine(nextFireAt: string | null): string {
  if (!nextFireAt) return '';
  return `下次 ${nextFireAt.slice(5, 16).replace('T', ' ')}`;
}

function GoalForm(props: {
  open: boolean;
  goal: GoalItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { open, goal, onOpenChange } = props;
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
          <DialogTitle>{goal ? '编辑目标' : '新目标'}</DialogTitle>
          <DialogDescription>
            目标是需要长期达成或维持的结果；总管负责把它拆成任务并汇报进展。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <Input
            placeholder="目标：例如 每天检查 tian-agent 的 CI 状态"
            aria-label="目标"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="完成标准（可选）：例如 连续 7 天全绿"
            aria-label="完成标准"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          <Input
            placeholder="约束（可选）：例如 只读，不创建 Issue"
            aria-label="约束"
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
          <label className="flex items-center gap-2 font-mono text-[10px] text-content-secondary">
            每日执行上限
            <Input
              type="number"
              min={1}
              max={48}
              aria-label="每日执行上限"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              size="sm"
              className="w-20"
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
          <Button onClick={submit} disabled={!objective.trim()}>
            {goal ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ScheduleRow({ goal }: { goal: GoalItem }) {
  const [adding, setAdding] = useState(false);
  const [cron, setCron] = useState('');
  return (
    <div className="flex flex-col gap-1">
      {goal.schedules.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-2 rounded-md bg-secondary/60 px-2 py-1"
        >
          <span className="font-mono text-[10px] text-content-secondary">
            cron {s.cron} · {s.timezone}
          </span>
          <span className="ml-auto font-mono text-[10px] text-content-disabled">
            {scheduleLine(s.nextFireAt)}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="删除调度"
            onClick={() => void actions.removeSchedule(s.id)}
          >
            <Trash2 className="size-3" />
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
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="cron 表达式，如 30 9 * * *"
            aria-label="Cron 表达式"
            size="sm"
            autoFocus
          />
          <Button type="submit" size="sm" variant="outline">
            添加
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdding(false)}
          >
            取消
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="self-start font-mono text-[10px] text-content-secondary"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3" /> 定时唤醒
        </Button>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  onEdit,
  reduce,
}: {
  goal: GoalItem;
  onEdit: (goal: GoalItem) => void;
  reduce: boolean | null;
}) {
  const open = goal.status === 'active';
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      className="rounded-lg border border-border bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2">
        <Badge
          variant={goalBadge[goal.status]}
          size="sm"
          className="mt-0.5 shrink-0 font-mono"
        >
          {goalStatusText[goal.status]}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] leading-snug">
            {goal.objective}
          </p>
          {goal.currentState && (
            <p className="mt-1 text-[12px] text-content-secondary leading-snug">
              现状:{goal.currentState}
            </p>
          )}
          {goal.nextAction && (
            <p className="mt-0.5 text-[12px] text-content-secondary leading-snug">
              下一步:{goal.nextAction}
            </p>
          )}
          {goal.lastExecution && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-content-disabled">
              上次执行 {goal.lastExecution.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </div>
        {open && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="立即执行"
              title="立即执行"
              onClick={() => void actions.runGoalNow(goal.id)}
            >
              <Play className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={goal.status === 'paused' ? '恢复目标' : '暂停目标'}
              title={goal.status === 'paused' ? '恢复' : '暂停'}
              onClick={() =>
                void actions.setGoalStatus(
                  goal.id,
                  goal.status === 'paused' ? 'active' : 'paused',
                )
              }
            >
              {goal.status === 'paused' ? (
                <Play className="size-3.5" />
              ) : (
                <Pause className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="编辑目标"
              title="编辑"
              onClick={() => onEdit(goal)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="取消目标"
              title="取消"
              onClick={() => void actions.setGoalStatus(goal.id, 'cancelled')}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div className="mt-2">
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
    return <p className="py-2 text-[12px] text-content-disabled">暂无任务。</p>;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <SectionLabel label={group.label} count={group.items.length} />
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
                  className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-secondary"
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
                        className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${
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
                          className="shrink-0 font-mono"
                        >
                          目标
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-content-disabled">
                      <span className="truncate">{t.scopeId}</span>
                      {t.due && (
                        <span className="ml-auto shrink-0">
                          {t.due.slice(0, 10)}
                        </span>
                      )}
                    </span>
                  </span>
                  {t.status === 'completed' && (
                    <Check className="mt-1 size-3.5 shrink-0 text-success-foreground" />
                  )}
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

  return (
    <main
      aria-label="Goals"
      className="flex min-w-0 flex-1 flex-col bg-background"
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
              aria-label="新目标"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="新对话"
              onClick={() => {
                actions.setNav('chat');
                void actions.newConversation('global');
              }}
            >
              <MessageSquare className="size-4" />
            </Button>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          <form
            className="mb-6 flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              await actions.addTask(draft.trim());
              setDraft('');
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="添加待办…"
              aria-label="New task"
              size="sm"
            />
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Add task"
              disabled={!draft.trim()}
            >
              <Plus className="size-4" />
            </Button>
          </form>

          {openGoals.length === 0 && closedGoals.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Target className="size-5 text-content-disabled" />
              <p className="text-[12px] text-content-secondary">
                还没有目标。创建一个，让总管为你长期跟进。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                新目标
              </Button>
            </div>
          )}

          {openGoals.length > 0 && (
            <section aria-label="进行中的目标" className="mb-8">
              <SectionLabel label="目标" count={openGoals.length} />
              <ul className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {openGoals.map((goal) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
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
            <section aria-label="提醒" className="mb-8">
              <SectionLabel label="提醒" count={notices.length} />
              <ul className="flex flex-col gap-1.5">
                {notices.slice(0, 10).map((n) => (
                  <li
                    key={n.id}
                    className={`rounded-lg border px-3 py-2 ${
                      n.deliveredAt
                        ? 'border-border bg-card'
                        : 'border-border-sky/50 bg-surface-sky/15'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[10px] text-content-disabled">
                        {n.fingerprint}
                      </span>
                      {!n.deliveredAt && (
                        <Badge variant="info" size="sm" className="font-mono">
                          new
                        </Badge>
                      )}
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-content-disabled">
                        {n.createdAt.slice(5, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-[12px] text-content-secondary leading-snug">
                      {n.text}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {closedGoals.length > 0 && (
            <section aria-label="已结束的目标" className="mb-8">
              <SectionLabel label="已结束" count={closedGoals.length} />
              <ul className="flex flex-col gap-1">
                {closedGoals.map((goal) => (
                  <li
                    key={goal.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    <Badge
                      variant={goalBadge[goal.status]}
                      size="sm"
                      className="shrink-0 font-mono"
                    >
                      {goalStatusText[goal.status]}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-content-secondary">
                      {goal.objective}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="恢复目标"
                      title="恢复"
                      onClick={() =>
                        void actions.setGoalStatus(goal.id, 'active')
                      }
                    >
                      <Play className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="任务">
            <SectionLabel label="任务" count={tasks.length} />
            <TaskList tasks={tasks} />
          </section>
        </div>
      </ScrollArea>

      <GoalForm open={dialogOpen} goal={editing} onOpenChange={setDialogOpen} />
    </main>
  );
}

export function InboxView() {
  const inbox = useStore((s) => s.inbox);
  const reduce = useReducedMotion();
  const unread = inbox.filter((m) => !m.read).length;

  return (
    <main
      aria-label="Inbox"
      className="flex min-w-0 flex-1 flex-col bg-background"
    >
      <Header icon={InboxIcon} title="Inbox" meta={`${unread} unread`} />
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {inbox.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center">
              <InboxIcon className="size-5 text-content-disabled" />
              <p className="text-[12px] text-content-secondary">
                Nothing here. Messages from agents and runs land here.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {inbox.map((m) => (
                  <motion.li
                    key={m.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    className={`rounded-lg border px-3.5 py-3 ${
                      m.read
                        ? 'border-border bg-card'
                        : 'border-border-sky/50 bg-surface-sky/15'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="truncate font-medium text-[12px]">
                        {m.from}
                      </span>
                      {m.to && (
                        <span className="font-mono text-[10px] text-content-disabled">
                          → {m.to}
                        </span>
                      )}
                      {!m.read && (
                        <Badge variant="info" size="sm" className="font-mono">
                          new
                        </Badge>
                      )}
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-content-disabled">
                        {m.ts.slice(5, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[13px] text-content-secondary leading-relaxed">
                      {m.body}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}
