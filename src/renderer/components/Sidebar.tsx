import { useState } from 'react';
import {
  CaretRight,
  ChatCircleDots,
  ChatCircleText,
  FolderPlus,
  Lightning,
  MagnifyingGlass,
  Plus,
  SlidersHorizontal,
  Sparkle,
  Target,
  Tray,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
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
import { Kbd } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConversationInfo, ScopeInfo } from '@/shared/types';
import { actions, useStore } from '../store';
import { CountPulse, Reveal } from './motion-primitives';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { BrandMark } from './BrandMark';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function ConversationRow(props: {
  conversation: ConversationInfo;
  active: boolean;
}) {
  const { conversation: c, active } = props;
  const reduce = useReducedMotion();
  return (
    <motion.button
      layout={!reduce}
      type="button"
      aria-label={`Conversation: ${c.title ?? 'New conversation'}`}
      aria-current={active ? 'true' : undefined}
      onClick={() =>
        void actions.selectConversation(c.conversationId, c.scopeId)
      }
      className={`group relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active
          ? 'text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground'
      }`}
    >
      {active && (
        <>
          <motion.span
            layoutId="conversation-active"
            transition={
              reduce
                ? { duration: 0 }
                : { type: 'spring', stiffness: 500, damping: 38 }
            }
            className="absolute inset-0 rounded-lg bg-sidebar-accent"
          />
          <motion.span
            layoutId="conversation-active-bar"
            transition={
              reduce
                ? { duration: 0 }
                : { type: 'spring', stiffness: 500, damping: 38 }
            }
            className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand"
          />
        </>
      )}
      <ChatCircleText
        size={14}
        weight={active ? 'fill' : 'regular'}
        className={`relative shrink-0 ${
          active ? 'text-brand' : 'text-content-disabled'
        }`}
      />
      <span className="relative min-w-0 flex-1 truncate text-[12.5px]">
        {c.title ?? 'New conversation'}
      </span>
      <span
        className={`relative shrink-0 font-mono text-[10px] tabular-nums transition-colors ${
          active
            ? 'text-content-secondary'
            : 'text-content-disabled group-hover:text-content-secondary'
        }`}
      >
        {relativeTime(c.createdAt)}
      </span>
    </motion.button>
  );
}

/** Top-level destination: Chat / Goals / Inbox. */
function NavItem(props: {
  icon: Icon;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const { icon: IconComponent, label, active, badge = 0, onClick } = props;
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      className={`group relative flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
        active
          ? 'font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-accent-foreground'
      }`}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          transition={
            reduce
              ? { duration: 0 }
              : { type: 'spring', stiffness: 500, damping: 38 }
          }
          className="absolute inset-0 rounded-lg bg-sidebar-accent"
        />
      )}
      <IconComponent
        size={16}
        weight={active ? 'fill' : 'regular'}
        className={`relative shrink-0 transition-colors ${
          active ? 'text-brand' : 'text-content-secondary'
        }`}
      />
      <span className="relative flex-1 text-left">{label}</span>
      <span className="relative">
        <CountPulse value={badge} />
      </span>
    </motion.button>
  );
}

function ScopeSection(props: {
  scope: ScopeInfo;
  conversations: ConversationInfo[];
  activeId: string | null;
  collapsed: boolean;
}) {
  const { scope, conversations, activeId, collapsed } = props;
  return (
    <section aria-label={`Scope: ${scope.name}`} className="mb-1.5">
      <div className="group flex h-7 items-center gap-1 px-1">
        <button
          type="button"
          aria-label={`Select scope ${scope.name}`}
          onClick={() => void actions.selectScope(scope.id)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.1em] transition-colors hover:text-content-secondary"
          title={scope.rootPath}
        >
          {scope.name}
          {collapsed && conversations.length > 0 && (
            <span className="ml-1.5 text-content-disabled/60">
              {conversations.length}
            </span>
          )}
        </button>
        <div className="flex items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          {scope.kind === 'project' && <ProjectSettingsDialog scope={scope} />}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`New conversation in ${scope.name}`}
                  onClick={() => void actions.newConversation(scope.id)}
                />
              }
            >
              <ChatCircleDots size={14} />
            </TooltipTrigger>
            <TooltipPopup>New conversation</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <Reveal open={!collapsed}>
        <div className="flex flex-col gap-px">
          {conversations.map((c) => (
            <ConversationRow
              key={c.conversationId}
              conversation={c}
              active={c.conversationId === activeId}
            />
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-1.5 font-mono text-[10px] text-content-disabled">
              no conversations yet
            </p>
          )}
        </div>
      </Reveal>
    </section>
  );
}

export function Sidebar() {
  const scopes = useStore((s) => s.scopes);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const nav = useStore((s) => s.nav);
  const inbox = useStore((s) => s.inbox);
  const tasks = useStore((s) => s.tasks);
  const skills = useStore((s) => s.skills);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const reduce = useReducedMotion();

  const q = query.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) => (c.title ?? '').toLowerCase().includes(q))
    : conversations;
  const globalScope = scopes.find((s) => s.kind === 'global');
  const projects = scopes.filter((s) => s.kind === 'project');
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const unread = inbox.filter((m) => !m.read).length;

  const connected = runtimeStatus === 'ready';
  const statusLabel =
    runtimeStatus === 'ready'
      ? 'service connected'
      : runtimeStatus === 'starting'
        ? 'connecting…'
        : runtimeStatus === 'disconnected'
          ? 'reconnecting…'
          : 'service unavailable';

  return (
    <aside
      aria-label="Navigation"
      className="flex min-h-0 w-full flex-col border-border border-r bg-sidebar text-sidebar-foreground"
    >
      {/* Traffic-light gutter + window drag handle for the hidden-inset title bar. */}
      <div
        aria-hidden="true"
        className="h-9 shrink-0 [-webkit-app-region:drag]"
      />

      <div className="relative flex items-center gap-2.5 bg-[radial-gradient(18rem_6rem_at_18%_0%,hsl(var(--brand)/0.1),transparent_70%)] px-3 pt-1 pb-3">
        <BrandMark glow />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[13px] text-foreground leading-tight tracking-tight">
            Tian
          </div>
          <div className="truncate font-mono text-[10px] text-content-secondary leading-tight">
            大内总管
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open command palette"
                className="text-content-secondary"
                onClick={() => actions.setPaletteOpen(true)}
              />
            }
          >
            <MagnifyingGlass size={15} />
          </TooltipTrigger>
          <TooltipPopup>
            Command palette <Kbd className="ml-1.5">⌘K</Kbd>
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open settings"
                className="text-content-secondary"
                onClick={() => actions.setSettingsOpen(true)}
              />
            }
          >
            <SlidersHorizontal size={15} />
          </TooltipTrigger>
          <TooltipPopup>Settings</TooltipPopup>
        </Tooltip>
      </div>

      <div className="px-2 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="group h-8 w-full justify-start gap-2 border-border bg-transparent px-2.5 text-[12.5px] text-content-secondary shadow-none hover:border-border-secondary hover:bg-sidebar-accent/60 hover:text-foreground"
          onClick={() => void actions.newConversation(activeScopeId)}
        >
          <Plus
            size={14}
            className="text-brand transition-transform duration-200 group-hover:rotate-90"
          />
          New conversation
          <Kbd className="ms-auto h-4 bg-sidebar-accent px-1 font-mono text-[9px]">
            ⌘N
          </Kbd>
        </Button>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2 pb-3">
        <NavItem
          icon={ChatCircleDots}
          label="Chat"
          active={nav === 'chat'}
          onClick={() => actions.setNav('chat')}
        />
        <NavItem
          icon={Target}
          label="Goals"
          active={nav === 'goals'}
          badge={pendingTasks}
          onClick={() => actions.setNav('goals')}
        />
        <NavItem
          icon={Lightning}
          label="Skills"
          active={nav === 'skills'}
          badge={skills.filter((s) => s.status === 'candidate').length}
          onClick={() => actions.setNav('skills')}
        />
        <NavItem
          icon={Tray}
          label="Inbox"
          active={nav === 'inbox'}
          badge={unread}
          onClick={() => actions.setNav('inbox')}
        />
      </nav>

      <div className="mx-3 border-border border-t" />

      <div className="flex items-center gap-1 px-3 pt-3 pb-1.5">
        <button
          type="button"
          aria-expanded={!projectsCollapsed}
          onClick={() => setProjectsCollapsed((v) => !v)}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.1em] transition-colors hover:text-content-secondary"
        >
          <motion.span
            animate={{ rotate: projectsCollapsed ? 0 : 90 }}
            transition={{
              duration: reduce ? 0 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="inline-flex"
          >
            <CaretRight size={10} weight="bold" />
          </motion.span>
          Projects
          <span className="ms-1 text-content-disabled/60 tabular-nums">
            {projects.length}
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Add project"
                className="text-content-secondary"
                onClick={() => setDialogOpen(true)}
              />
            }
          >
            <FolderPlus size={14} />
          </TooltipTrigger>
          <TooltipPopup>Add project</TooltipPopup>
        </Tooltip>
      </div>

      <div className="px-2.5 pb-2">
        <div className="group relative">
          <MagnifyingGlass
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-content-disabled transition-colors group-focus-within:text-content-secondary"
          />
          <Input
            placeholder="Search conversations"
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="sm"
            className="h-7 bg-transparent pr-7 pl-8 text-[11.5px]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-content-disabled transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1 px-2 pb-2"
        scrollbarGutter
        scrollFade
      >
        {globalScope && (
          <ScopeSection
            scope={globalScope}
            conversations={filtered.filter((c) => c.scopeId === globalScope.id)}
            activeId={activeId}
            collapsed={projectsCollapsed}
          />
        )}
        {projects.map((p) => (
          <ScopeSection
            key={p.id}
            scope={p}
            conversations={filtered.filter((c) => c.scopeId === p.id)}
            activeId={activeId}
            collapsed={projectsCollapsed}
          />
        ))}
        {projects.length === 0 && !projectsCollapsed && (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-border px-3 py-3">
            <p className="text-[11px] text-content-secondary leading-relaxed">
              No projects yet. Add a directory to give the steward a workspace.
            </p>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-2 flex cursor-pointer items-center gap-1 font-medium text-[11px] text-brand transition-opacity hover:opacity-80"
            >
              <Plus size={11} /> Add a project
            </button>
          </div>
        )}
        <div className="h-2" />
      </ScrollArea>

      <div className="flex items-center gap-2 border-border border-t px-3 py-2.5">
        <span className="relative flex size-2 shrink-0">
          {connected && (
            <span className="absolute inset-0 animate-ping rounded-full bg-foreground opacity-30 motion-reduce:animate-none" />
          )}
          <span
            className={`relative size-2 rounded-full ${
              connected
                ? 'bg-foreground'
                : runtimeStatus === 'starting' ||
                    runtimeStatus === 'disconnected'
                  ? 'animate-pulse bg-warning'
                  : 'bg-destructive'
            }`}
          />
        </span>
        <span className="truncate font-mono text-[10px] text-content-disabled">
          {statusLabel}
        </span>
        <Sparkle
          size={11}
          weight="fill"
          className="ml-auto text-content-disabled/60"
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand/12 text-brand">
                <FolderPlus size={15} />
              </span>
              New project
            </DialogTitle>
            <DialogDescription>
              Register a directory as a scope for the steward.
            </DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim() || !path.trim()) return;
              await actions.addProject(name.trim(), path.trim());
              setName('');
              setPath('');
              setDialogOpen(false);
            }}
          >
            <DialogPanel className="grid gap-3">
              <Input
                placeholder="Name"
                aria-label="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Input
                  placeholder="/path/to/project"
                  aria-label="Project path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const picked = await window.tian.pickDir();
                    if (picked) {
                      setPath(picked);
                      if (!name.trim())
                        setName(picked.split('/').filter(Boolean).pop() ?? '');
                    }
                  }}
                >
                  Browse
                </Button>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={!name.trim() || !path.trim()}>
                Add project
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </aside>
  );
}
