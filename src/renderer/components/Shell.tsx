import { Suspense, lazy } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowsClockwise,
  CaretDoubleLeft,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { actions, useStore } from '../store';
import { Sidebar } from './Sidebar';
import { PaneDivider } from './PaneDivider';
import { EASE } from './motion-primitives';
import { Button } from '@/components/ui/button';

const ChatView = lazy(() =>
  import('./ChatView').then((m) => ({ default: m.ChatView })),
);
const InboxView = lazy(() =>
  import('./NavViews').then((m) => ({ default: m.InboxView })),
);
const GoalsView = lazy(() =>
  import('./NavViews').then((m) => ({ default: m.GoalsView })),
);
const LogView = lazy(() =>
  import('./LogView').then((m) => ({ default: m.LogView })),
);
const ContextPane = lazy(() =>
  import('./ContextPane').then((m) => ({ default: m.ContextPane })),
);

/** Context pane width while collapsed: just the vertical rail. */
const RAIL_WIDTH = 44;

/** One banner for both error and reconnect states; text comes from a table. */
function ConnectionBanner() {
  const operationError = useStore((s) => s.operationError);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const reduce = useReducedMotion();
  const state = operationError
    ? 'error'
    : runtimeStatus === 'disconnected'
      ? 'disconnected'
      : runtimeStatus === 'starting'
        ? 'starting'
        : null;
  return (
    <motion.div
      layout={!reduce}
      transition={{ duration: 0.2, ease: EASE }}
      className="shrink-0 overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {state && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <BannerBody state={state} operationError={operationError} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const BANNER_COPY = {
  error: {
    title: '操作未完成',
    detail: '请检查服务设置后重试。',
    tone: 'text-destructive-foreground',
  },
  disconnected: {
    title: '后台服务已断开',
    detail: '任务继续在后台运行。重新连接后可继续查看。',
    tone: 'text-content-secondary',
  },
  starting: {
    title: '正在重新连接后台服务',
    detail: '正在重新连接后台服务…',
    tone: 'text-content-secondary',
  },
} as const;

function BannerBody({
  state,
  operationError,
}: {
  state: keyof typeof BANNER_COPY;
  operationError: string | null;
}) {
  const copy = BANNER_COPY[state];
  const detail = operationError ?? copy.detail;
  return (
    <div
      role={state === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2.5 border-border border-b bg-surface-secondary/40 px-4 py-2"
    >
      <span
        aria-hidden="true"
        className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-tertiary ${copy.tone}`}
      >
        {state === 'error' ? (
          <WarningCircle size={12} />
        ) : (
          <ArrowsClockwise
            size={11}
            className="animate-spin [animation-duration:2.5s]"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[11.5px] text-foreground">
          {copy.title}
        </p>
        <p
          className="mt-0.5 truncate font-mono text-[10px] text-content-secondary"
          title={detail}
        >
          {detail}
        </p>
      </div>
      <Button
        size="xs"
        variant="ghost"
        className="shrink-0 text-content-secondary"
        onClick={() => actions.setSettingsOpen(true)}
      >
        服务设置
      </Button>
      {state === 'error' && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-content-secondary"
          aria-label="Dismiss error"
          onClick={actions.clearError}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}

function MainPane() {
  const nav = useStore((s) => s.nav);
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      transition={
        reduce
          ? { duration: 0 }
          : { type: 'spring', stiffness: 320, damping: 34, mass: 0.7 }
      }
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ConnectionBanner />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={nav}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {nav === 'chat' ? (
            <Suspense fallback={null}>
              <ChatView />
            </Suspense>
          ) : nav === 'goals' ? (
            <Suspense fallback={null}>
              <GoalsView />
            </Suspense>
          ) : nav === 'log' ? (
            <Suspense fallback={null}>
              <LogView />
            </Suspense>
          ) : (
            <Suspense fallback={null}>
              <InboxView />
            </Suspense>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The right pane and its collapsed rail share one grid column. Collapsing
 * animates a transform and a constant-width column, so the conversation never
 * reflows frame by frame the way an animated `width` would.
 */
function ContextSide({
  width,
  dragging,
  onResize,
  onDraggingChange,
}: {
  width: number;
  dragging: boolean;
  onResize: (width: number) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const contextOpen = useStore((s) => s.contextOpen);
  const reduce = useReducedMotion();
  const transition =
    reduce || dragging ? { duration: 0 } : { duration: 0.24, ease: EASE };
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {contextOpen ? (
        <motion.div
          key="context"
          initial={reduce ? false : { x: width + 2, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={reduce ? undefined : { x: width + 2, opacity: 0 }}
          transition={transition}
          className="flex min-h-0 shrink-0 overflow-hidden"
          style={{ width: width + 2 }}
        >
          <PaneDivider
            side="right"
            label="Resize context pane"
            width={width}
            min={280}
            max={640}
            onResize={onResize}
            onDraggingChange={onDraggingChange}
          />
          <div style={{ width }} className="flex min-h-0">
            <Suspense fallback={null}>
              <ContextPane />
            </Suspense>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="rail"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className="flex shrink-0 flex-col items-center overflow-hidden border-border border-l bg-sidebar py-2"
          style={{ width: RAIL_WIDTH }}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show context pane"
            className="text-content-secondary hover:text-foreground"
            onClick={() => actions.setContextOpen(true)}
          >
            <CaretDoubleLeft size={15} />
          </Button>
          <span className="mt-3 font-mono text-[9px] text-content-disabled uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
            Context
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Three-pane shell: navigation, conversation, context. */
export function Shell({
  navWidth,
  onNavResize,
  contextWidth,
  contextDragging,
  onContextResize,
  onContextDraggingChange,
}: {
  navWidth: number;
  onNavResize: (width: number) => void;
  contextWidth: number;
  contextDragging: boolean;
  onContextResize: (width: number) => void;
  onContextDraggingChange: (dragging: boolean) => void;
}) {
  return (
    // No role="application": it would suppress the screen reader's own
    // navigation shortcuts for the whole app.
    <div
      aria-label="Tian Agent"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      <div
        className="flex min-h-0 shrink-0 overflow-hidden"
        style={{ width: navWidth }}
      >
        <Sidebar />
      </div>
      <PaneDivider
        side="left"
        label="Resize navigation"
        width={navWidth}
        min={200}
        max={380}
        onResize={onNavResize}
      />
      <MainPane />
      <ContextSide
        width={contextWidth}
        dragging={contextDragging}
        onResize={onContextResize}
        onDraggingChange={onContextDraggingChange}
      />
    </div>
  );
}
