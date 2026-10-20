import { useMemo } from 'react';
import {
  ArrowsClockwise,
  ChatCircleDots,
  Folder,
  Gear,
  Lightning,
  Sidebar,
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
import { useLocale, useT } from '../i18n';
import type { Nav } from '../state';

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
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const t = useT();
  const locale = useLocale();

  const items = useMemo<PaletteItem[]>(() => {
    const close = () => actions.setPaletteOpen(false);
    const go = (nav: Nav) => () => {
      actions.setNav(nav);
      close();
    };
    const commands: PaletteItem[] = [
      {
        value: 'new conversation',
        label: t('common.newConversation'),
        hint: t('palette.newConversationHint'),
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
        label: t('palette.goChat'),
        shortcut: '⌘1',
        icon: ChatCircleDots,
        run: go('chat'),
      },
      {
        value: 'go goals',
        label: t('palette.goGoals'),
        shortcut: '⌘2',
        icon: Target,
        run: go('goals'),
      },
      {
        value: 'go skills',
        label: t('palette.goSkills'),
        shortcut: '⌘3',
        icon: Lightning,
        run: go('skills'),
      },
      {
        value: 'go inbox',
        label: t('palette.goInbox'),
        shortcut: '⌘4',
        icon: Tray,
        run: go('inbox'),
      },
      {
        value: 'go settings',
        label: t('palette.goSettings'),
        shortcut: '⌘,',
        icon: Gear,
        run: go('settings'),
      },
      {
        value: 'toggle sidebar',
        label: t(sidebarOpen ? 'toggle.hideSidebar' : 'toggle.showSidebar'),
        shortcut: '⌃⌘S',
        icon: Sidebar,
        run: () => {
          actions.setSidebarOpen(!sidebarOpen);
          close();
        },
      },
      {
        value: 'toggle context pane',
        label: t(contextOpen ? 'toggle.hideContext' : 'toggle.showContext'),
        shortcut: '⌘B',
        icon: SidebarSimple,
        run: () => {
          actions.setContextOpen(!contextOpen);
          close();
        },
      },
      {
        value: 'refresh models',
        label: t('palette.refreshModels'),
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
        hint: t('palette.switchScope'),
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
        label: c.title ?? t('common.newConversation'),
        hint: scopeName.get(c.scopeId),
        icon: ChatCircleDots,
        run: () => {
          void actions.selectConversation(c.conversationId, c.scopeId);
          actions.setNav('chat');
          close();
        },
      }));

    return [...commands, ...scopeItems, ...conversationItems];
  }, [
    activeScopeId,
    contextOpen,
    sidebarOpen,
    conversations,
    scopes,
    t,
    locale,
  ]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => actions.setPaletteOpen(next)}
    >
      <CommandDialogPopup aria-label={t('palette.aria')}>
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
            placeholder={t('palette.input')}
            aria-label={t('palette.inputAria')}
          />
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
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
                {t('palette.navigate')}
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="h-4 min-w-4 bg-secondary px-0.5">↵</Kbd>
                {t('palette.open')}
              </span>
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-content-disabled">
              <Kbd className="h-4 min-w-4 bg-secondary px-0.5">esc</Kbd>
              {t('palette.close')}
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
