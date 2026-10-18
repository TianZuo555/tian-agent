import { useState } from 'react';
import {
  CornerUpRight,
  FileCode2,
  FileText,
  GitMerge,
  Plus,
  Ship,
  Trash2,
} from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { tian } from '../api';
import type { RunInfo } from '@/shared/types';
import { actions, useStore } from '../store';

function TasksPanel() {
  const tasks = useStore((s) => s.tasks);
  const [draft, setDraft] = useState('');
  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="min-h-0 flex-1 p-2">
        {tasks.length === 0 && (
          <div className="p-2 text-muted-foreground text-xs">No tasks</div>
        )}
        {tasks.map((t) => (
          <label
            key={t.id}
            aria-label={`Task: ${t.title}`}
            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/60"
          >
            <Checkbox
              className="mt-0.5"
              checked={t.status === 'done'}
              onCheckedChange={(checked) =>
                void actions.toggleTask(t.id, checked === true)
              }
            />
            <span
              className={
                t.status === 'done' ? 'text-muted-foreground line-through' : ''
              }
            >
              {t.title}
              {t.due && (
                <span className="ml-1.5 text-muted-foreground/70">
                  due {t.due.slice(0, 10)}
                </span>
              )}
            </span>
          </label>
        ))}
      </ScrollArea>
      <form
        className="flex items-center gap-1.5 border-border border-t p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          await actions.addTask(draft.trim());
          setDraft('');
        }}
      >
        <Input
          className="h-8 text-xs shadow-none"
          aria-label="New task title"
          placeholder="Add a task…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Add task"
          disabled={!draft.trim()}
        >
          <Plus className="size-4" />
        </Button>
      </form>
    </div>
  );
}

function MemoryPanel() {
  const memory = useStore((s) => s.memory);
  if (!memory)
    return <div className="p-3 text-muted-foreground text-xs">No memory</div>;
  return (
    <ScrollArea className="h-full p-2">
      {memory.pendingMerges > 0 && (
        <Badge
          variant="outline"
          className="mb-2 border-amber-500/40 font-normal text-[10px] text-amber-500"
        >
          {memory.pendingMerges} merges pending
        </Badge>
      )}
      {memory.lines.length === 0 ? (
        <div className="p-2 text-muted-foreground text-xs">Empty memory</div>
      ) : (
        <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground leading-relaxed">
          {memory.lines.map((l, i) => `#${i} ${l}`).join('\n')}
        </pre>
      )}
    </ScrollArea>
  );
}

function InboxPanel() {
  const inbox = useStore((s) => s.inbox);
  return (
    <ScrollArea className="h-full p-2">
      {inbox.length === 0 && (
        <div className="p-2 text-muted-foreground text-xs">Inbox is empty</div>
      )}
      {inbox.map((m) => (
        <div
          key={m.id}
          className={`mb-2 rounded-lg border px-2.5 py-2 text-xs ${
            m.read
              ? 'border-border/60 text-muted-foreground'
              : 'border-primary/30 bg-primary/5'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate font-medium">
              {m.from}
              {m.to ? ` → ${m.to}` : ''}
            </span>
            <span className="shrink-0">
              {m.ts.slice(0, 16).replace('T', ' ')}
            </span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words">{m.body}</div>
        </div>
      ))}
    </ScrollArea>
  );
}

const statusVariant: Record<
  RunInfo['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  running: 'secondary',
  queued: 'outline',
  done: 'default',
  failed: 'destructive',
  interrupted: 'destructive',
  discarded: 'outline',
};

function RunTextDialog({
  run,
  title,
  fetchText,
  triggerLabel,
  icon,
}: {
  run: RunInfo;
  title: string;
  fetchText: () => Promise<string>;
  triggerLabel: string;
  icon: React.ReactNode;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setText(null);
          void fetchText()
            .then(setText)
            .catch((e) => setText(`Error: ${e}`));
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-5 gap-1 px-1.5 text-[10px]"
            aria-label={`${triggerLabel} for run ${run.id.slice(0, 8)}`}
          />
        }
      >
        {icon}
        {triggerLabel}
      </DialogTrigger>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {title} — run {run.id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription>
            {run.branch ? `${run.branch} ` : ''}
            {run.worktreePath ?? run.projectId}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ScrollArea className="max-h-96">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {text ?? 'Loading…'}
            </pre>
          </ScrollArea>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function FollowUpDialog({ run }: { run: RunInfo }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-5 gap-1 px-1.5 text-[10px]"
            aria-label={`Follow up on run ${run.id.slice(0, 8)}`}
          />
        }
      >
        <CornerUpRight className="size-3" />
        Follow up
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Follow up on run {run.id.slice(0, 8)}</DialogTitle>
          <DialogDescription>
            Same worker and worktree, one more round.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            aria-label="Follow-up instruction"
            placeholder="What should it change next?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            aria-label="Send follow-up"
            disabled={!prompt.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await actions.followUpRun(run.id, prompt.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ConfirmAction({
  label,
  icon,
  ariaLabel,
  confirm,
  action,
}: {
  label: string;
  icon: React.ReactNode;
  ariaLabel: string;
  confirm: string;
  action: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-5 gap-1 px-1.5 text-[10px]"
            aria-label={ariaLabel}
          />
        }
      >
        {icon}
        {label}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{confirm}</DialogDescription>
        </DialogHeader>
        {error && (
          <DialogPanel>
            <div role="alert" className="text-destructive text-xs">
              {error}
            </div>
          </DialogPanel>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </DialogClose>
          <DialogClose
            render={
              <Button
                size="sm"
                aria-label={`Confirm ${label}`}
                disabled={busy}
              />
            }
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await action();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RunCard({ run }: { run: RunInfo }) {
  const live = run.status === 'running' || run.status === 'queued';
  const reviewable = run.status === 'done' || run.status === 'failed';
  return (
    <div
      role="article"
      aria-label={`Run ${run.id.slice(0, 8)}: ${run.status}`}
      className="mb-2 rounded-lg border border-border/60 px-2.5 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {run.id.slice(0, 8)}
        </span>
        <Badge
          variant={statusVariant[run.status]}
          className="font-normal text-[10px]"
        >
          {run.status}
        </Badge>
      </div>
      <div className="mt-1.5 line-clamp-2">{run.prompt}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {run.agentKind} · {run.startedAt.slice(0, 16).replace('T', ' ')}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
        <RunTextDialog
          run={run}
          title="Report"
          triggerLabel="Report"
          icon={<FileText className="size-3" />}
          fetchText={() => tian.runReport(run.id)}
        />
        {run.branch && (
          <RunTextDialog
            run={run}
            title="Diff"
            triggerLabel="Diff"
            icon={<FileCode2 className="size-3" />}
            fetchText={() => tian.runDiff(run.id)}
          />
        )}
        {!live && run.status !== 'discarded' && <FollowUpDialog run={run} />}
        {reviewable && run.branch && (
          <>
            <ConfirmAction
              label="Land"
              icon={<GitMerge className="size-3" />}
              ariaLabel={`Land run ${run.id.slice(0, 8)}`}
              confirm={`Merge ${run.branch} into the project's current branch? The worktree is removed after.`}
              action={() => actions.landRun(run.id)}
            />
            <ConfirmAction
              label="Ship"
              icon={<Ship className="size-3" />}
              ariaLabel={`Ship run ${run.id.slice(0, 8)}`}
              confirm={`Push ${run.branch} and open a PR with gh?`}
              action={() => actions.shipRun(run.id)}
            />
          </>
        )}
        {run.status !== 'discarded' && (
          <ConfirmAction
            label="Discard"
            icon={<Trash2 className="size-3" />}
            ariaLabel={`Discard run ${run.id.slice(0, 8)}`}
            confirm="Delete the worktree and branch? The run's changes are lost."
            action={() => actions.discardRun(run.id)}
          />
        )}
      </div>
    </div>
  );
}

function RunsPanel() {
  const runs = useStore((s) => s.runs);
  return (
    <ScrollArea className="h-full p-2">
      {runs.length === 0 && (
        <div className="p-2 text-muted-foreground text-xs">
          No runs dispatched
        </div>
      )}
      {runs.map((r) => (
        <RunCard key={r.id} run={r} />
      ))}
    </ScrollArea>
  );
}

export function RightPanel() {
  const tab = useStore((s) => s.tab);
  return (
    <aside
      aria-label="Tasks, memory, inbox and runs"
      className="flex w-80 shrink-0 flex-col border-border border-l bg-background"
    >
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={tab}
        onValueChange={(v) => actions.setTab(v as typeof tab)}
      >
        <TabsList className="m-2 grid shrink-0 grid-cols-4" size="sm">
          <TabsTab value="tasks">Tasks</TabsTab>
          <TabsTab value="memory">Memory</TabsTab>
          <TabsTab value="inbox">Inbox</TabsTab>
          <TabsTab value="runs">Runs</TabsTab>
        </TabsList>
        <TabsPanel value="tasks" className="min-h-0 flex-1 overflow-hidden">
          <TasksPanel />
        </TabsPanel>
        <TabsPanel value="memory" className="min-h-0 flex-1 overflow-hidden">
          <MemoryPanel />
        </TabsPanel>
        <TabsPanel value="inbox" className="min-h-0 flex-1 overflow-hidden">
          <InboxPanel />
        </TabsPanel>
        <TabsPanel value="runs" className="min-h-0 flex-1 overflow-hidden">
          <RunsPanel />
        </TabsPanel>
      </Tabs>
    </aside>
  );
}
