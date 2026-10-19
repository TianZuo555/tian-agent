import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { actions, useStore } from '../store';

/**
 * The navigation sidebar's toggle, carried at the head of the content pane
 * the way a Mac app carries it in the toolbar: next to the traffic lights
 * when the sidebar is hidden, at the seam when it shows. The icon is
 * Magpie's side-toggle glyph — a pane that fills while the sidebar shows.
 */
export function SidebarToggle() {
  const open = useStore((s) => s.sidebarOpen);
  const label = open ? 'Hide sidebar' : 'Show sidebar';
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={open}
            aria-keyshortcuts="Control+Meta+S"
            className="shrink-0 text-content-secondary [-webkit-app-region:no-drag]"
            onClick={() => actions.setSidebarOpen(!open)}
          />
        }
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="2.5"
            y="3.5"
            width="4"
            height="9"
            rx="1"
            fill="currentColor"
            className={`transition-opacity duration-300 motion-reduce:transition-none ${
              open ? 'opacity-30' : 'opacity-0'
            }`}
          />
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />
            <path d="M6.75 2.75v10.5" />
          </g>
        </svg>
      </TooltipTrigger>
      <TooltipPopup>
        {label}
        <Kbd className="ml-1.5">⌃⌘S</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
