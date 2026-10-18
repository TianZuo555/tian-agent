import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Shared easing — quick out, no bounce. Everything in the shell uses this so
 * the app feels like one hand drew it.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = 0.22;
/** Slightly longer, used for larger surfaces entering or leaving. */
export const SLOW = 0.34;

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
      initial={{ opacity: 0, y: 8, filter: 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.3, ease: EASE }}
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
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 24 }}
      className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/12 px-1 font-mono font-semibold text-[9px] text-brand tabular-nums"
    >
      {value}
    </motion.span>
  );
}

/**
 * Staggered list entrance: children rise in sequence. `layout` on the parent
 * keeps removals from snapping the rest of the list.
 */
export function StaggerList({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.035, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 6 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.28, ease: EASE },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Soft cross-fade used when a panel swaps its content. */
export function FadeSwap({
  swapKey,
  children,
  className,
}: {
  swapKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={swapKey}
        className={className}
        initial={reduce ? false : { opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -3 }}
        transition={{ duration: 0.16, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Three dots that lift in sequence — the "thinking" state. */
export function TypingDots({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-end gap-[3px] ${className}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 animate-typing rounded-full bg-current"
          style={{ animationDelay: `${i * 0.14}s` }}
        />
      ))}
    </span>
  );
}

/**
 * Page transition for the three primary destinations. The outgoing view leaves
 * faster than the incoming one arrives so navigation feels immediate.
 */
export function PageSwap({
  pageKey,
  children,
  className,
}: {
  pageKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        className={className}
        initial={reduce ? false : { opacity: 0, y: 6, scale: 0.996 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={
          reduce
            ? undefined
            : { opacity: 0, y: -4, transition: { duration: 0.1 } }
        }
        transition={{ duration: 0.2, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
