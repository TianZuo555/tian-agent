import { useState } from 'react';
import {
  FolderPlus,
  Inbox,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Settings2,
  Sparkles,
  Target,
} from 'lucide-react';
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
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConversationInfo, ScopeInfo } from '@/shared/types';
import { actions, useStore } from '../store';
import { CountPulse } from './motion-primitives';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

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
  return (
    <button
      type="button"
      aria-label={`Conversation: ${c.title ?? 'New conversation'}`}
      aria-current={active ? 'true' : undefined}
      onClick={() =>
        void actions.selectConversation(c.conversationId, c.scopeId)
      }
      className={`group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {c.title ?? 'New conversation'}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-content-disabled tabular-nums">
        {relativeTime(c.createdAt)}
      </span>
    </button>
  );
}

/** Top-level destination: Chat / Goals / Inbox. */
function NavItem(props: {
  icon: typeof MessageSquare;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const { icon: Icon, label, active, badge = 0, onClick } = props;
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
      }`}
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      <span className="flex-1 text-left">{label}</span>
      <CountPulse value={badge} />
    </button>
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
    <section aria-label={`Scope: ${scope.name}`} className="mb-1">
      <div className="group flex h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          aria-label={`Select scope ${scope.name}`}
          onClick={() => void actions.selectScope(scope.id)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.09em] hover:text-content-secondary"
          title={scope.rootPath}
        >
          {scope.name}
          {collapsed && conversations.length > 0 && (
            <span className="ml-1 text-content-disabled/60">
              {conversations.length}
            </span>
          )}
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
              <MessageSquarePlus className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup>New conversation</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-px">
          {conversations.map((c) => (
            <ConversationRow
              key={c.conversationId}
              conversation={c}
              active={c.conversationId === activeId}
            />
          ))}
          {conversations.length === 0 && (
            <p className="px-2 py-1 font-mono text-[10px] text-content-disabled">
              no conversations
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function Sidebar() {
  const scopes = useStore((s) => s.scopes);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const nav = useStore((s) => s.nav);
  const inbox = useStore((s) => s.inbox);
  const tasks = useStore((s) => s.tasks);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? conversations.filter((c) => (c.title ?? '').toLowerCase().includes(q))
    : conversations;
  const globalScope = scopes.find((s) => s.kind === 'global');
  const projects = scopes.filter((s) => s.kind === 'project');

  return (
    <aside
      aria-label="Navigation"
      className="flex min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground"
    >
      {/* Traffic-light gutter + window drag handle for the hidden-inset title bar. */}
      <div
        aria-hidden="true"
        className="h-9 shrink-0 [-webkit-app-region:drag]"
      />

      <div className="flex items-center gap-2 px-3 pb-2.5">
        <div className="flex size-6 items-center justify-center rounded-sm bg-foreground text-background">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[13px] text-foreground leading-tight">
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
                aria-label="Open settings"
                onClick={() => actions.setSettingsOpen(true)}
              />
            }
          >
            <Settings2 className="size-4" />
          </TooltipTrigger>
          <TooltipPopup>Settings</TooltipPopup>
        </Tooltip>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-px px-2 pb-2">
        <NavItem
          icon={MessageSquare}
          label="Chat"
          active={nav === 'chat'}
          onClick={() => actions.setNav('chat')}
        />
        <NavItem
          icon={Target}
          label="Goals"
          active={nav === 'goals'}
          badge={tasks.filter((t) => t.status === 'pending').length}
          onClick={() => actions.setNav('goals')}
        />
        <NavItem
          icon={Inbox}
          label="Inbox"
          active={nav === 'inbox'}
          badge={inbox.filter((m) => !m.read).length}
          onClick={() => actions.setNav('inbox')}
        />
      </nav>

      <div className="mx-2 border-border border-t" />

      <div className="flex items-center gap-1 px-3 pt-3 pb-1.5">
        <button
          type="button"
          aria-expanded={!projectsCollapsed}
          onClick={() => setProjectsCollapsed((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.09em] hover:text-content-secondary"
        >
          Projects
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Add project"
                onClick={() => setDialogOpen(true)}
              />
            }
          >
            <FolderPlus className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>Add project</TooltipPopup>
        </Tooltip>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-content-disabled" />
          <Input
            placeholder="Search conversations"
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="sm"
            className="bg-transparent pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-2" scrollbarGutter>
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
          <p className="px-1.5 pt-2 text-[11px] text-content-disabled leading-relaxed">
            No projects yet. Add one to give the steward a workspace.
          </p>
        )}
        <div className="h-2" />
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
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
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </aside>
  );
}
