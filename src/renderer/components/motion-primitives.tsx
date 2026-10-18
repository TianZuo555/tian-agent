import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/** Shared easing — quick out, no bounce. Matches the Coder flat aesthetic. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = 0.22;

/**
 * Message entrance: fades and lifts a few pixels. Skipped entirely when the
 * user asks for reduced motion, or when the row is streaming (its text is
 * already animating through Streamdown).
 */
export function MessageIn({
  children,
  animate,
}: {
  children: ReactNode;
  animate: boolean;
}) {
  const reduce = useReducedMotion();
  if (!animate || reduce) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Collapsible body used by tool chips and the run report. */
export function Reveal({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: DURATION, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A count that pops when it changes — used for the context tab badges. */
export function CountPulse({ value }: { value: number }) {
  const reduce = useReducedMotion();
  if (value <= 0) return null;
  return (
    <motion.span
      key={value}
      initial={reduce ? false : { scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.16, ease: EASE }}
      className="ml-0.5 rounded-sm bg-surface-tertiary px-1 font-mono text-[9px] text-content-secondary tabular-nums"
    >
      {value}
    </motion.span>
  );
}
