import { cn } from '@/lib/utils';

/**
 * The card's 44px title strip. Every pane carries the same frosted row with
 * one hairline seam, so the top of the window reads as a single glass bar
 * split only by the panes' own dividers — Qoder's floating-card layout.
 *
 * The leading inset animates on the same curve and duration as the panes
 * themselves, so the sidebar toggle glides with the rail it controls instead
 * of jumping to the window edge a frame before the rail arrives.
 */
export function PaneHeader({
  clearance = false,
  inset = 'default',
  className = '',
  children,
}: {
  /** Reserve the hidden-inset traffic lights' space (sidebar folded). */
  clearance?: boolean;
  inset?: 'default' | 'compact';
  className?: string;
  children?: React.ReactNode;
}) {
  const padding =
    inset === 'compact' ? 'px-3' : clearance ? 'pr-4 pl-20' : 'px-4';
  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex h-11 shrink-0 items-center gap-2 border-border/50 border-b bg-background/80 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_1px_2px_0_rgba(0,0,0,0.02)] backdrop-blur-xl transition-[padding] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:border-white/[0.06] dark:bg-background/60 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] [-webkit-app-region:drag]',
        padding,
        className,
      )}
    >
      {children}
    </header>
  );
}
