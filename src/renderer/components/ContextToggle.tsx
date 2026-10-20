import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { actions, useStore } from '../store';
import { useT } from '../i18n';

/**
 * The context pane's toggle, carried at the content header's right edge —
 * the mirror image of SidebarToggle's glyph: its right pane fills while the
 * pane shows.
 */
export function ContextToggle() {
  const open = useStore((s) => s.contextOpen);
  const t = useT();
  const label = t(open ? 'toggle.hideContext' : 'toggle.showContext');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={open}
            aria-keyshortcuts="Meta+B"
            className="shrink-0 text-content-secondary [-webkit-app-region:no-drag]"
            onClick={() => actions.setContextOpen(!open)}
          />
        }
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="9.5"
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
            <path d="M9.25 2.75v10.5" />
          </g>
        </svg>
      </TooltipTrigger>
      <TooltipPopup>
        {label}
        <Kbd className="ml-1.5">⌘B</Kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
