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
    // The main pane re-lays out whenever a rail folds. It rides the same
    // tween as the rail's own slide, so the toggle in its header travels with
    // the card edge instead of lagging behind it on a separate spring.
    <motion.div
      layout={!reduce}
      transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
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
    //
    // The window is a desktop around one floating card: the navigation rail
    // sits on the desktop, while the conversation and the context pane share
    // a single rounded, shadowed surface whose title strip runs unbroken
    // across both (Qoder's layout). The rail only draws a divider when it is
    // open; folded, the card takes the whole window.
    // `relative` keeps the exiting panes' popLayout absolute boxes inside this
    // clipped box: without a positioned ancestor they escape it, and a pane
    // sliding off the right edge would briefly widen the document and flash
    // window scrollbars.
    <div
      aria-label="Tian Agent"
      className="relative flex h-screen overflow-hidden bg-window/75 text-foreground backdrop-blur-3xl dark:bg-window/50"
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
              quiet
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* The gutter between the card and the window edges: the card floats on
          the desktop rather than filling it, so the rail and the chrome read as
          a frame around the workspace. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col py-1.5 pr-1.5 pl-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-[0_1px_2px_hsl(0_0%_0%/0.04),0_10px_28px_-18px_hsl(0_0%_0%/0.3)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-background/90 dark:shadow-[0_1px_2px_hsl(0_0%_0%/0.5),0_20px_50px_-24px_hsl(0_0%_0%/0.75),inset_0_1px_0_hsl(0_0%_100%/0.06)]">
          <div className="flex min-h-0 min-w-0 flex-1">
            <MainPane />
            <ContextSide
              width={contextWidth}
              dragging={contextDragging}
              onResize={onContextResize}
              onDraggingChange={onContextDraggingChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
