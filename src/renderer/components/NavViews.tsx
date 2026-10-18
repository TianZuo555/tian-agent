import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  Inbox as InboxIcon,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TaskItem } from '@/shared/types';
import { actions, useStore } from '../store';
import { EASE } from './motion-primitives';

function Header({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon: typeof CalendarClock;
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

type TaskGroup = { key: string; label: string; items: TaskItem[] };

function groupTasks(tasks: TaskItem[]): TaskGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);

  const overdue: TaskItem[] = [];
  const thisWeek: TaskItem[] = [];
  const later: TaskItem[] = [];
  const someday: TaskItem[] = [];
  const done: TaskItem[] = [];

  for (const t of tasks) {
    if (t.status === 'completed') {
      done.push(t);
      continue;
    }
    if (!t.due) {
      someday.push(t);
      continue;
    }
    const due = new Date(t.due);
    if (due < today) overdue.push(t);
    else if (due < soon) thisWeek.push(t);
    else later.push(t);
  }

  return [
    { key: 'overdue', label: 'Overdue', items: overdue },
    { key: 'week', label: 'This week', items: thisWeek },
    { key: 'later', label: 'Later', items: later },
    { key: 'someday', label: 'Someday', items: someday },
    { key: 'done', label: 'Done', items: done },
  ].filter((g) => g.items.length > 0);
}

export function ScheduleView() {
  const tasks = useStore((s) => s.tasks);
  const [draft, setDraft] = useState('');
  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const open = tasks.filter((t) => t.status === 'pending').length;
  const reduce = useReducedMotion();

  return (
    <main
      aria-label="Schedule"
      className="flex min-w-0 flex-1 flex-col bg-background"
    >
      <Header
        icon={CalendarClock}
        title="Schedule"
        meta={`${open} open`}
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            onClick={() => {
              actions.setNav('chat');
              void actions.newConversation('global');
            }}
          >
            <MessageSquare className="size-4" />
          </Button>
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
              placeholder="Add a task…"
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

          {groups.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-20 text-center">
              <CalendarClock className="size-5 text-content-disabled" />
              <p className="text-[12px] text-content-secondary">
                Nothing scheduled. Ask the steward to plan something.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className="font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.09em]">
                    {group.label}
                  </h2>
                  <span className="font-mono text-[10px] text-content-disabled/70 tabular-nums">
                    {group.items.length}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
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
                          onCheckedChange={(checked) =>
                            void actions.toggleTask(t.id, checked === true)
                          }
                          aria-label={`Task: ${t.title}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-[13px] leading-snug ${
                              t.status === 'completed'
                                ? 'text-content-disabled line-through'
                                : 'text-foreground'
                            }`}
                          >
                            {t.title}
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
        </div>
      </ScrollArea>
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
