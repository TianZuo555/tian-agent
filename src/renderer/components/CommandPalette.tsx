import { useMemo } from 'react';
import {
  ArrowsClockwise,
  ChatCircleDots,
  Folder,
  Gear,
  Lightning,
  SidebarSimple,
  Target,
  Tray,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { actions, useStore } from '../store';

interface PaletteItem {
  value: string;
  label: string;
  hint?: string;
  shortcut?: string;
  icon: Icon;
  run: () => void;
}

/**
 * ⌘K palette. Everything reachable from the shell is one command away:
 * destinations, conversations, scopes, and the handful of global toggles.
 */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const conversations = useStore((s) => s.conversations);
  const scopes = useStore((s) => s.scopes);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const contextOpen = useStore((s) => s.contextOpen);

  const items = useMemo<PaletteItem[]>(() => {
    const close = () => actions.setPaletteOpen(false);
    const go = (nav: 'chat' | 'goals' | 'skills' | 'inbox') => () => {
      actions.setNav(nav);
      close();
    };
    const commands: PaletteItem[] = [
      {
        value: 'new conversation',
        label: 'New conversation',
        hint: 'in the active scope',
        shortcut: '⌘N',
        icon: ChatCircleDots,
        run: () => {
          void actions.newConversation(activeScopeId);
          actions.setNav('chat');
          close();
        },
      },
      {
        value: 'go chat',
        label: 'Go to Chat',
        shortcut: '⌘1',
        icon: ChatCircleDots,
        run: go('chat'),
      },
      {
        value: 'go goals',
        label: 'Go to Goals',
        shortcut: '⌘2',
        icon: Target,
        run: go('goals'),
      },
      {
        value: 'go inbox',
        label: 'Go to Inbox',
        shortcut: '⌘3',
        icon: Tray,
        run: go('inbox'),
      },
      {
        value: 'go skills',
        label: 'Go to Skills',
        shortcut: '⌘4',
        icon: Lightning,
        run: go('skills'),
      },
      {
        value: 'toggle context pane',
        label: contextOpen ? 'Hide context pane' : 'Show context pane',
        shortcut: '⌘B',
        icon: SidebarSimple,
        run: () => {
          actions.setContextOpen(!contextOpen);
          close();
        },
      },
      {
        value: 'open settings',
        label: 'Open settings',
        shortcut: '⌘,',
        icon: Gear,
        run: () => {
          actions.setSettingsOpen(true);
          close();
        },
      },
      {
        value: 'refresh models',
        label: 'Refresh model catalog',
        icon: ArrowsClockwise,
        run: () => {
          void actions.refreshModels();
          close();
        },
      },
    ];

    const scopeName = new Map(scopes.map((s) => [s.id, s.name]));
    const scopeItems: PaletteItem[] = scopes
      .filter((s) => s.id !== activeScopeId)
      .map((scope) => ({
        value: `scope ${scope.name}`,
        label: scope.name,
        hint: 'switch scope',
        icon: Folder,
        run: () => {
          void actions.selectScope(scope.id);
          close();
        },
      }));

    const conversationItems: PaletteItem[] = conversations
      .slice(0, 40)
      .map((c) => ({
        value: `conversation ${c.conversationId}`,
        label: c.title ?? 'New conversation',
        hint: scopeName.get(c.scopeId),
        icon: ChatCircleDots,
        run: () => {
          void actions.selectConversation(c.conversationId, c.scopeId);
          actions.setNav('chat');
          close();
        },
      }));

    return [...commands, ...scopeItems, ...conversationItems];
  }, [activeScopeId, contextOpen, conversations, scopes]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => actions.setPaletteOpen(next)}
    >
      <CommandDialogPopup aria-label="Command palette">
        <Command
          items={items}
          itemToStringValue={(item) => (item as PaletteItem).label}
          filter={(item, query) => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            const entry = item as PaletteItem;
            return `${entry.label} ${entry.hint ?? ''} ${entry.value}`
              .toLowerCase()
              .includes(q);
          }}
        >
          <CommandInput
            placeholder="Jump to a conversation or run a command…"
            aria-label="Search commands"
          />
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          <CommandList>
            {(item) => {
              const entry = item as PaletteItem;
              const Icon = entry.icon;
              return (
                <CommandItem
                  key={entry.value}
                  value={entry}
                  className="data-highlighted:bg-surface-tertiary data-highlighted:shadow-[inset_2px_0_0_hsl(var(--brand))]"
                  onClick={() => entry.run()}
                >
                  <span className="me-2 flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary">
                    <Icon size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint && (
                    <span className="ms-3 truncate font-mono text-[10px] text-content-disabled">
                      {entry.hint}
                    </span>
                  )}
                  {entry.shortcut && (
                    <CommandShortcut className="ms-3">
                      {entry.shortcut}
                    </CommandShortcut>
                  )}
                </CommandItem>
              );
            }}
          </CommandList>
          <CommandFooter>
            <span className="flex items-center gap-3 text-content-secondary">
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4 bg-secondary px-0.5">↑</Kbd>
                <Kbd className="h-4 min-w-4 bg-secondary px-0.5">↓</Kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4 bg-secondary px-0.5">↵</Kbd>
                open
              </span>
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-content-disabled">
              <Kbd className="h-4 min-w-4 bg-secondary px-0.5">esc</Kbd>
              close
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
