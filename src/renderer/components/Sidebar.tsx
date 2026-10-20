import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BoxArrowUp,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  ChatCircleText,
  FolderPlus,
  Gear,
  Lightning,
  MagnifyingGlass,
  Plus,
  Target,
  Tray,
  UserGear,
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
import type { Nav } from '../state';
import { actions, useStore } from '../store';
import { t, useT, type MessageKey } from '../i18n';
import { CountPulse, Reveal } from './motion-primitives';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { BrandMark } from './BrandMark';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.m', { n: min });
  const hours = Math.round(min / 60);
  if (hours < 24) return t('time.h', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t('time.d', { n: days });
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Hover-revealed archive/restore affordance floating over a row's meta. */
function RowAction({
  conversation,
  archived,
}: {
  conversation: ConversationInfo;
  archived: boolean;
}) {
  const t = useT();
  const title = conversation.title ?? t('common.newConversation');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t(
              archived ? 'sidebar.restoreAction' : 'sidebar.archiveAction',
              { title },
            )}
            className="absolute top-1/2 right-1 -translate-y-1/2 bg-sidebar-accent text-content-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={() =>
              void actions.archiveConversation(
                conversation.conversationId,
                !archived,
              )
            }
          />
        }
      >
        {archived ? (
          <BoxArrowUp size={13} aria-hidden="true" />
        ) : (
          <Archive size={13} aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        {t(archived ? 'sidebar.restore' : 'sidebar.archiveTooltip')}
      </TooltipPopup>
    </Tooltip>
  );
}

function ConversationRow(props: {
  conversation: ConversationInfo;
  active: boolean;
  archived?: boolean;
  scopeName?: string;
}) {
  const { conversation: c, active, archived = false, scopeName } = props;
  const reduce = useReducedMotion();
  const t = useT();
  const title = c.title ?? t('common.newConversation');
  const when = relativeTime(
    archived ? (c.archivedAt ?? c.createdAt) : c.createdAt,
  );
  const meta = archived && scopeName ? `${scopeName} · ${when}` : when;
  const RowIcon = c.role === 'manager' ? UserGear : ChatCircleText;
  const label = t(
    c.role === 'manager'
      ? archived
        ? 'sidebar.archivedManagerLabel'
        : 'sidebar.managerLabel'
      : archived
        ? 'sidebar.archivedConversationLabel'
        : 'sidebar.conversationLabel',
    { title },
  );
  return (
    <motion.div layout={!reduce} className="group relative">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        onClick={() =>
          void actions.selectConversation(c.conversationId, c.scopeId)
        }
        className={`relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
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
        <RowIcon
          size={14}
          weight={active ? 'fill' : 'regular'}
          aria-hidden
          className={`relative shrink-0 ${
            active ? 'text-brand' : 'text-content-disabled'
          }`}
        />
        <span className="relative min-w-0 flex-1 truncate text-[12.5px]">
          {title}
        </span>
        <span
          className={`relative max-w-28 min-w-0 shrink-0 truncate font-mono text-[10px] tabular-nums transition-[color,opacity] group-hover:opacity-0 ${
            active
              ? 'text-content-secondary'
              : 'text-content-disabled group-hover:text-content-secondary'
          }`}
        >
          {meta}
        </span>
      </button>
      <RowAction conversation={c} archived={archived} />
    </motion.div>
  );
}

/** Top-level destination: Chat / Goals / Inbox / Log. */
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

/** Conversations rendered per scope before the group folds. */
const VISIBLE_CONVERSATIONS = 5;

function ScopeSection(props: {
  scope: ScopeInfo;
  conversations: ConversationInfo[];
  activeId: string | null;
  collapsed: boolean;
}) {
  const { scope, conversations, activeId, collapsed } = props;
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  // Fold everything past the first five, but keep the selected conversation
  // visible so the list never hides where the reader currently is. The
  // project's manager conversation always sorts first within its scope.
  const { visible, hiddenCount } = useMemo(() => {
    const ordered = [...conversations].sort(
      (a, b) => Number(b.role === 'manager') - Number(a.role === 'manager'),
    );
    if (expanded || ordered.length <= VISIBLE_CONVERSATIONS)
      return { visible: ordered, hiddenCount: 0 };
    const shown = ordered.slice(0, VISIBLE_CONVERSATIONS);
    const active = ordered.find((c) => c.conversationId === activeId);
    if (active && !shown.includes(active)) shown.push(active);
    const shownIds = new Set(shown);
    return {
      visible: ordered.filter((c) => shownIds.has(c)),
      hiddenCount: ordered.length - shown.length,
    };
  }, [activeId, conversations, expanded]);
  const collapsible = conversations.length > VISIBLE_CONVERSATIONS;
  return (
    <section
      aria-label={t('sidebar.scopeLabel', { name: scope.name })}
      className="mb-1.5"
    >
      <div className="group flex h-7 items-center gap-1 px-1">
        <button
          type="button"
          aria-label={t('sidebar.selectScope', { name: scope.name })}
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
          {scope.kind === 'project' && (
            <>
              <ProjectSettingsDialog scope={scope} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('sidebar.openManager', {
                        name: scope.name,
                      })}
                      onClick={() => void actions.openManager(scope.id)}
                    />
                  }
                >
                  <UserGear size={14} aria-hidden />
                </TooltipTrigger>
                <TooltipPopup>{t('sidebar.projectManager')}</TooltipPopup>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('sidebar.newConversationIn', {
                    name: scope.name,
                  })}
                  onClick={() => void actions.newConversation(scope.id)}
                />
              }
            >
              <ChatCircleDots size={14} />
            </TooltipTrigger>
            <TooltipPopup>{t('sidebar.newConversationTooltip')}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <Reveal open={!collapsed}>
        <div className="flex flex-col gap-px">
          {visible.map((c) => (
            <ConversationRow
              key={c.conversationId}
              conversation={c}
              active={c.conversationId === activeId}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-content-disabled transition-colors hover:bg-sidebar-accent/55 hover:text-content-secondary"
            >
              <CaretDown size={10} weight="bold" />
              {t('sidebar.showMore')}
              <span className="font-mono text-[10px] tabular-nums">
                ({hiddenCount})
              </span>
            </button>
          )}
          {expanded && collapsible && (
            <button
              type="button"
              aria-expanded
              onClick={() => setExpanded(false)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-content-disabled transition-colors hover:bg-sidebar-accent/55 hover:text-content-secondary"
            >
              <CaretRight size={10} weight="bold" />
              {t('sidebar.showLess')}
            </button>
          )}
          {conversations.length === 0 && (
            <p className="px-2 py-1.5 font-mono text-[10px] text-content-disabled">
              {t('sidebar.noConversations')}
            </p>
          )}
        </div>
      </Reveal>
    </section>
  );
}

/**
 * The sidebar's segment of the unified title bar: same 44px row, same bottom
 * hairline, and the same drag region as every content header, so the top of
 * the window reads as one continuous strip (Codex-style). The leading pad
 * clears the hidden-inset traffic lights.
 */
function SidebarBrand() {
  const t = useT();
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-border border-b pr-2 pl-20 [-webkit-app-region:drag]">
      <BrandMark glow />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-[13px] text-foreground leading-tight tracking-tight">
          Tian
        </div>
        <div className="truncate font-mono text-[10px] text-content-secondary leading-tight">
          {t('sidebar.tagline')}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('sidebar.commandPalette')}
              className="text-content-secondary [-webkit-app-region:no-drag]"
              onClick={() => actions.setPaletteOpen(true)}
            />
          }
        >
          <MagnifyingGlass size={15} />
        </TooltipTrigger>
        <TooltipPopup>
          {t('sidebar.commandPalette')} <Kbd className="ml-1.5">⌘K</Kbd>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Chat / Goals / Skills / Inbox destinations with their badges. */
function PrimaryNav({
  nav,
  pendingTasks,
  candidates,
  unread,
}: {
  nav: Nav;
  pendingTasks: number;
  candidates: number;
  unread: number;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t('sidebar.primaryNav')}
      className="flex flex-col gap-0.5 px-2 pb-3"
    >
      <NavItem
        icon={ChatCircleDots}
        label={t('nav.chat')}
        active={nav === 'chat'}
        onClick={() => actions.setNav('chat')}
      />
      <NavItem
        icon={Target}
        label={t('nav.goals')}
        active={nav === 'goals'}
        badge={pendingTasks}
        onClick={() => actions.setNav('goals')}
      />
      <NavItem
        icon={Lightning}
        label={t('nav.skills')}
        active={nav === 'skills'}
        badge={candidates}
        onClick={() => actions.setNav('skills')}
      />
      <NavItem
        icon={Tray}
        label={t('nav.inbox')}
        active={nav === 'inbox'}
        badge={unread}
        onClick={() => actions.setNav('inbox')}
      />
    </nav>
  );
}

const SERVICE_STATUS: Record<
  'ready' | 'starting' | 'disconnected' | 'failed',
  { label: MessageKey; dot: string; live: boolean }
> = {
  ready: {
    label: 'service.connected',
    dot: 'bg-foreground',
    live: true,
  },
  starting: {
    label: 'service.connecting',
    dot: 'animate-pulse bg-warning',
    live: false,
  },
  disconnected: {
    label: 'service.reconnecting',
    dot: 'animate-pulse bg-warning',
    live: false,
  },
  failed: {
    label: 'service.unavailable',
    dot: 'bg-destructive',
    live: false,
  },
};

/** Bottom-right gear: the only entry point to the settings page. */
function SettingsGear({ active, count }: { active: boolean; count: number }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('sidebar.openSettings')}
            aria-current={active ? 'page' : undefined}
            className={`ml-auto shrink-0 ${
              active ? 'text-brand' : 'text-content-secondary'
            }`}
            onClick={() => actions.toggleSettings()}
          />
        }
      >
        <Gear size={14} weight={active ? 'fill' : 'regular'} />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-brand font-mono text-[7.5px] text-brand-contrast tabular-nums"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </TooltipTrigger>
      <TooltipPopup>
        {t('nav.settings')}
        <Kbd className="ml-1.5">⌘,</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}

/** Service connection footer with the settings gear at the far right. */
function ServiceStatus({
  status,
  active,
  openImprovements,
}: {
  status: 'ready' | 'starting' | 'disconnected' | 'failed';
  active: boolean;
  openImprovements: number;
}) {
  const t = useT();
  const copy = SERVICE_STATUS[status];
  return (
    <div className="flex items-center gap-2 border-border border-t px-3 py-2.5">
      <span className="relative flex size-2 shrink-0">
        {copy.live && (
          <span className="absolute inset-0 animate-ping rounded-full bg-foreground opacity-30 motion-reduce:animate-none" />
        )}
        <span className={`relative size-2 rounded-full ${copy.dot}`} />
      </span>
      <span
        role="status"
        className="truncate font-mono text-[10px] text-content-disabled"
      >
        {t(copy.label)}
      </span>
      <SettingsGear active={active} count={openImprovements} />
    </div>
  );
}

/** Register a local directory as a project scope. */
function AddProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const t = useT();
  // Move focus once the dialog is inserted; unlike the autoFocus attribute
  // this also works for content added after first paint.
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand/12 text-brand">
              <FolderPlus size={15} />
            </span>
            {t('sidebar.addProjectTitle')}
          </DialogTitle>
          <DialogDescription>{t('sidebar.addProjectDesc')}</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !path.trim()) return;
            await actions.addProject(name.trim(), path.trim());
            setName('');
            setPath('');
            onOpenChange(false);
          }}
        >
          <DialogPanel className="grid gap-3">
            <Input
              ref={nameRef}
              placeholder={t('sidebar.projectName')}
              aria-label={t('sidebar.projectNameAria')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex gap-2">
              <Input
                placeholder={t('sidebar.projectPath')}
                aria-label={t('sidebar.projectPathAria')}
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
                {t('common.browse')}
              </Button>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={!name.trim() || !path.trim()}>
              {t('sidebar.addProject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
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
  const improvements = useStore((s) => s.improvements);
  const skills = useStore((s) => s.skills);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const reduce = useReducedMotion();
  const t = useT();

  const globalScope = scopes.find((s) => s.kind === 'global');
  const projects = scopes.filter((s) => s.kind === 'project');
  const liveConversations = conversations.filter((c) => !c.archivedAt);
  const archivedConversations = conversations
    .filter((c) => c.archivedAt)
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const unread = inbox.filter((m) => !m.read).length;
  const openImprovements = improvements.filter(
    (entry) => entry.status === 'open',
  ).length;

  return (
    <aside
      aria-label={t('sidebar.navigation')}
      className="flex min-h-0 w-full flex-col border-border border-r bg-sidebar text-sidebar-foreground"
    >
      <SidebarBrand />

      <div className="px-2 pb-2 pt-2">
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
          {t('common.newConversation')}
          <Kbd className="ms-auto h-4 bg-sidebar-accent px-1 font-mono text-[9px]">
            ⌘N
          </Kbd>
        </Button>
      </div>

      <PrimaryNav
        nav={nav}
        pendingTasks={pendingTasks}
        candidates={skills.filter((s) => s.status === 'candidate').length}
        unread={unread}
      />

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
          {t('sidebar.projects')}
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
                aria-label={t('sidebar.addProject')}
                className="text-content-secondary"
                onClick={() => setDialogOpen(true)}
              />
            }
          >
            <FolderPlus size={14} />
          </TooltipTrigger>
          <TooltipPopup>{t('sidebar.addProject')}</TooltipPopup>
        </Tooltip>
      </div>

      <ScrollArea
        className="min-h-0 flex-1 px-2 pb-2"
        scrollbarGutter
        scrollFade
      >
        {globalScope && (
          <ScopeSection
            scope={globalScope}
            conversations={liveConversations.filter(
              (c) => c.scopeId === globalScope.id,
            )}
            activeId={activeId}
            collapsed={projectsCollapsed}
          />
        )}
        {projects.map((p) => (
          <ScopeSection
            key={p.id}
            scope={p}
            conversations={liveConversations.filter((c) => c.scopeId === p.id)}
            activeId={activeId}
            collapsed={projectsCollapsed}
          />
        ))}
        {projects.length === 0 && !projectsCollapsed && (
          <div className="mx-1 mt-2 rounded-lg border border-dashed border-border px-3 py-3">
            <p className="text-[11px] text-content-secondary leading-relaxed">
              {t('sidebar.noProjects')}
            </p>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-2 flex cursor-pointer items-center gap-1 font-medium text-[11px] text-brand transition-opacity hover:opacity-80"
            >
              <Plus size={11} /> {t('sidebar.addAProject')}
            </button>
          </div>
        )}
        {archivedConversations.length > 0 && (
          <section
            aria-label={t('sidebar.archivedSection')}
            className="mt-3 border-border/60 border-t pt-2"
          >
            <div className="flex h-7 items-center gap-1 px-1">
              <button
                type="button"
                aria-expanded={archiveOpen}
                onClick={() => setArchiveOpen((v) => !v)}
                className="group flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left font-medium font-mono text-[10px] text-content-disabled uppercase tracking-[0.1em] transition-colors hover:text-content-secondary"
              >
                <motion.span
                  animate={{ rotate: archiveOpen ? 90 : 0 }}
                  transition={{
                    duration: reduce ? 0 : 0.16,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="inline-flex"
                >
                  <CaretRight size={10} weight="bold" />
                </motion.span>
                {t('sidebar.archive')}
                <span className="ms-1 text-content-disabled/60 tabular-nums">
                  {archivedConversations.length}
                </span>
              </button>
            </div>
            <Reveal open={archiveOpen}>
              <div className="flex flex-col gap-px">
                {archivedConversations.map((c) => (
                  <ConversationRow
                    key={c.conversationId}
                    conversation={c}
                    active={c.conversationId === activeId}
                    archived
                    scopeName={scopes.find((s) => s.id === c.scopeId)?.name}
                  />
                ))}
              </div>
            </Reveal>
          </section>
        )}
        <div className="h-2" />
      </ScrollArea>

      <ServiceStatus
        status={runtimeStatus}
        active={nav === 'settings'}
        openImprovements={openImprovements}
      />

      <AddProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}
