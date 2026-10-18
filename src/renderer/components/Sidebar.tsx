import { useState } from 'react';
import { FolderPlus, MessageSquarePlus, Search, Settings2 } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { ConversationInfo, ScopeInfo } from '@/shared/types';
import { actions, useStore } from '../store';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

function ScopeSection(props: {
  scope: ScopeInfo;
  conversations: ConversationInfo[];
  activeId: string | null;
}) {
  return (
    <section aria-label={`Scope: ${props.scope.name}`}>
      <div className="flex items-center justify-between px-1.5 pt-1 pb-1">
        <button
          type="button"
          aria-label={`Select scope ${props.scope.name}`}
          onClick={() => void actions.selectScope(props.scope.id)}
          className="min-w-0 cursor-pointer truncate text-left font-medium text-[11px] text-sidebar-foreground/60 uppercase tracking-wider hover:text-sidebar-foreground"
          title={props.scope.rootPath}
        >
          {props.scope.name}
        </button>
        <div className="flex items-center">
          {props.scope.kind === 'project' && (
            <ProjectSettingsDialog scope={props.scope} />
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`New conversation in ${props.scope.name}`}
            onClick={() => void actions.newConversation(props.scope.id)}
          >
            <MessageSquarePlus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {props.conversations.map((c) => (
          <button
            key={c.conversationId}
            type="button"
            aria-label={`Conversation: ${c.title ?? 'Untitled'}`}
            aria-current={
              c.conversationId === props.activeId ? 'true' : undefined
            }
            onClick={() =>
              void actions.selectConversation(c.conversationId, c.scopeId)
            }
            className={`w-full cursor-pointer truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
              c.conversationId === props.activeId
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
            }`}
          >
            {c.title ?? 'Untitled'}
          </button>
        ))}
        {props.conversations.length === 0 && (
          <div className="px-2.5 py-1 text-sidebar-foreground/40 text-xs">
            No conversations
          </div>
        )}
      </div>
    </section>
  );
}

export function Sidebar() {
  const scopes = useStore((s) => s.scopes);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const q = query.toLowerCase();
  const filtered = q
    ? conversations.filter((c) => (c.title ?? '').toLowerCase().includes(q))
    : conversations;
  const globalScope = scopes.find((s) => s.kind === 'global');
  const projects = scopes.filter((s) => s.kind === 'project');

  return (
    <aside
      aria-label="Scopes and conversations"
      className="flex w-64 shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="font-semibold text-sm tracking-tight">
          Tian · 大内总管
        </span>
        <div className="flex items-center gap-0.5">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add project"
                />
              }
            >
              <FolderPlus className="size-4" />
            </DialogTrigger>
            <DialogPopup>
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
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <Input
                    placeholder="/path/to/project"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                  />
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open settings"
            onClick={() => actions.setSettingsOpen(true)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 opacity-50" />
          <Input
            placeholder="Search"
            aria-label="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 bg-sidebar-accent/40 pl-8 text-xs shadow-none"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        {globalScope && (
          <ScopeSection
            scope={globalScope}
            conversations={filtered.filter((c) => c.scopeId === globalScope.id)}
            activeId={activeId}
          />
        )}
        {projects.map((p) => (
          <div key={p.id}>
            <Separator className="my-2 bg-sidebar-border" />
            <ScopeSection
              scope={p}
              conversations={filtered.filter((c) => c.scopeId === p.id)}
              activeId={activeId}
            />
          </div>
        ))}
        {projects.length === 0 && (
          <p className="px-1.5 pt-3 text-sidebar-foreground/50 text-xs">
            No projects yet — add one to give the steward a scope.
          </p>
        )}
      </ScrollArea>
    </aside>
  );
}
