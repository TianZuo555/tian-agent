import { Suspense, lazy } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowsClockwise, WarningCircle, X } from '@phosphor-icons/react';
import { actions, useStore } from '../store';
import { Sidebar } from './Sidebar';
import { PaneDivider } from './PaneDivider';
import { EASE } from './motion-primitives';
import { Button } from '@/components/ui/button';
import { useT, type MessageKey } from '../i18n';

const ChatView = lazy(() =>
  import('./ChatView').then((m) => ({ default: m.ChatView })),
);
const InboxView = lazy(() =>
  import('./NavViews').then((m) => ({ default: m.InboxView })),
);
const GoalsView = lazy(() =>
  import('./NavViews').then((m) => ({ default: m.GoalsView })),
);
const SkillsView = lazy(() =>
  import('./NavViews').then((m) => ({ default: m.SkillsView })),
);
const SettingsView = lazy(() =>
  import('./SettingsView').then((m) => ({ default: m.SettingsView })),
);
const ContextPane = lazy(() =>
  import('./ContextPane').then((m) => ({ default: m.ContextPane })),
);

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

const BANNER_COPY: Record<
  'error' | 'disconnected' | 'starting',
  { title: MessageKey; detail: MessageKey; tone: string }
> = {
  error: {
    title: 'banner.error.title',
    detail: 'banner.error.detail',
    tone: 'text-destructive-foreground',
  },
  disconnected: {
    title: 'banner.disconnected.title',
    detail: 'banner.disconnected.detail',
    tone: 'text-content-secondary',
  },
  starting: {
    title: 'banner.starting.title',
    detail: 'banner.starting.detail',
    tone: 'text-content-secondary',
  },
};

function BannerBody({
  state,
  operationError,
}: {
  state: keyof typeof BANNER_COPY;
  operationError: string | null;
}) {
  const t = useT();
  const copy = BANNER_COPY[state];
  const detail = operationError ?? t(copy.detail);
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
          {t(copy.title)}
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
        onClick={() => actions.setNav('settings')}
      >
        {t('banner.serviceSettings')}
      </Button>
      {state === 'error' && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-content-secondary"
          aria-label={t('banner.dismissError')}
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
          ) : nav === 'skills' ? (
            <Suspense fallback={null}>
              <SkillsView />
            </Suspense>
          ) : nav === 'settings' ? (
            <Suspense fallback={null}>
              <SettingsView />
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
 * The right pane keeps no rail when folded — the header's toggle brings it
 * back. Collapsing animates a transform and a constant-width column, so the
 * conversation never reflows frame by frame the way an animated `width`
 * would.
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
  const t = useT();
  const transition =
    reduce || dragging ? { duration: 0 } : { duration: 0.24, ease: EASE };
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {contextOpen && (
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
            label={t('shell.resizeContext')}
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
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const reduce = useReducedMotion();
  const t = useT();
  return (
    // No role="application": it would suppress the screen reader's own
    // navigation shortcuts for the whole app.
    <div
      aria-label="Tian Agent"
      className="flex h-screen overflow-hidden bg-background text-foreground"
    >
      {/* Collapsed as ContextSide is: the column slides to the window's edge
          by transform while its space pops out of layout at once, so the
          conversation never reflows frame by frame. The divider rides along
          inside, its hover reach kept by the inner clip. */}
      <AnimatePresence initial={false} mode="popLayout">
        {sidebarOpen && (
          <motion.div
            key="nav"
            initial={reduce ? false : { x: -(navWidth + 2), opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? undefined : { x: -(navWidth + 2), opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
            className="flex min-h-0 shrink-0"
            style={{ width: navWidth + 2 }}
          >
            <div
              className="flex min-h-0 shrink-0 overflow-hidden"
              style={{ width: navWidth }}
            >
              <Sidebar />
            </div>
            <PaneDivider
              side="left"
              label={t('shell.resizeNav')}
              width={navWidth}
              min={200}
              max={380}
              onResize={onNavResize}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
