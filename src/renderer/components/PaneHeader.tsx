/**
 * The card's 44px title strip. Every pane carries the same row and none of
 * them draws a rule under it, so the top of the window reads as one bar that
 * only the panes' own divider splits — Qoder's floating-card layout.
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
      className={`flex h-11 shrink-0 items-center gap-2 transition-[padding] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] [-webkit-app-region:drag] motion-reduce:transition-none ${padding} ${className}`}
    >
      {children}
    </header>
  );
}
