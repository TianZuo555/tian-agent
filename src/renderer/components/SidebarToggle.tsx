import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { actions, useStore } from '../store';
import { useT } from '../i18n';
import { EASE } from './motion-primitives';

/**
 * A pane toggle — a frame whose panel fills while its pane shows. Both
 * toggles share this glyph so the pair reads as one control mirrored across
 * the card, and the fill animates on the same curve as the pane it describes.
 */
function PaneToggle({
  side,
  open,
  label,
  shortcut,
  keyshortcuts,
  onClick,
}: {
  side: 'left' | 'right';
  open: boolean;
  label: string;
  shortcut: string;
  keyshortcuts: string;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={open}
            aria-keyshortcuts={keyshortcuts}
            className="shrink-0 text-content-secondary [-webkit-app-region:no-drag]"
            onClick={onClick}
          />
        }
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <motion.rect
            initial={false}
            animate={{ opacity: open ? 0.3 : 0 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
            x={side === 'left' ? 2.5 : 9.5}
            y="3.5"
            width="4"
            height="9"
            rx="1"
            fill="currentColor"
          />
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
            <path d={side === 'left' ? 'M6.75 2.75v10.5' : 'M9.25 2.75v10.5'} />
          </g>
        </svg>
      </TooltipTrigger>
      <TooltipPopup>
        {label}
        <Kbd className="ml-1.5">{shortcut}</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}

/** The navigation sidebar's toggle, carried at the head of the content pane. */
export function SidebarToggle() {
  const open = useStore((s) => s.sidebarOpen);
  const t = useT();
  return (
    <PaneToggle
      side="left"
      open={open}
      label={t(open ? 'toggle.hideSidebar' : 'toggle.showSidebar')}
      shortcut="⌃⌘S"
      keyshortcuts="Control+Meta+S"
      onClick={() => actions.setSidebarOpen(!open)}
    />
  );
}

/** The context pane's toggle: the same glyph mirrored, at the same seam. */
export function ContextToggle() {
  const open = useStore((s) => s.contextOpen);
  const t = useT();
  return (
    <PaneToggle
      side="right"
      open={open}
      label={t(open ? 'toggle.hideContext' : 'toggle.showContext')}
      shortcut="⌘B"
      keyshortcuts="Meta+B"
      onClick={() => actions.setContextOpen(!open)}
    />
  );
}
