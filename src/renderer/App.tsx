import { Suspense, lazy, useEffect, useState } from 'react';
import { tian } from './api';
import {
  ArrowsClockwise,
  CaretDoubleLeft,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { actions, getState, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { PaneDivider, usePersistedWidth } from './components/PaneDivider';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE } from './components/motion-primitives';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IconProvider } from './components/IconProvider';
import { BrandOrb } from './components/BrandMark';

const ChatView = lazy(() =>
  import('./components/ChatView').then((m) => ({ default: m.ChatView })),
);
const InboxView = lazy(() =>
  import('./components/NavViews').then((m) => ({ default: m.InboxView })),
);
const GoalsView = lazy(() =>
  import('./components/NavViews').then((m) => ({ default: m.GoalsView })),
);
const ContextPane = lazy(() =>
  import('./components/ContextPane').then((m) => ({ default: m.ContextPane })),
);
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((m) => ({
    default: m.SettingsDialog,
  })),
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  })),
);

/**
 * Mounts the settings dialog only after it is first opened, so its chunk
 * (and the usage/service settings inside) load on demand. Stays mounted
 * afterwards so dialog exit animations still play on close.
 */
function DeferredSettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  );
}

function DeferredCommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette />
    </Suspense>
  );
}

/** Full-screen boot state: the mark breathes while the service handshakes. */
function BootScreen({ error }: { error: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="ambient-glow flex flex-1 flex-col items-center justify-center gap-6 px-8">
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <BrandOrb />
      </motion.div>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="font-semibold text-[15px] text-foreground tracking-tight">
          Tian Agent
        </span>
        {error ? (
          <div
            role="alert"
            className="flex max-w-sm flex-col items-center gap-1"
          >
            <span className="flex items-center gap-1.5 text-destructive-foreground text-xs">
              <WarningCircle size={14} />
              无法连接后台服务
            </span>
            <span className="text-content-secondary text-xs leading-relaxed">
              {error}
            </span>
          </div>
        ) : (
          <span className="shimmer-text font-mono text-[11px]">
            waking the steward…
          </span>
        )}
      </div>
      {error && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.setSettingsOpen(true)}
        >
          打开服务设置
        </Button>
      )}
    </div>
  );
}

/**
 * Three-pane shell: navigation, conversation, context. Both dividers drag;
 * the right pane slides in and out instead of popping.
 */
export function App() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const operationError = useStore((s) => s.operationError);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const contextOpen = useStore((s) => s.contextOpen);
  const nav = useStore((s) => s.nav);
  const reduce = useReducedMotion();
  const [navDragging, setNavDragging] = useState(false);
  const [contextDragging, setContextDragging] = useState(false);
  const [navWidth, setNavWidth] = usePersistedWidth(
    'tian.navWidth',
    264,
    200,
    380,
  );
  const [contextWidth, setContextWidth] = usePersistedWidth(
    'tian.contextWidth',
    360,
    280,
    640,
  );

  useEffect(() => actions.init(), []);
  useEffect(() => {
    void tian.desktop('ready').catch(() => {});
  }, []);
  // Global navigation shortcuts. Kept here so they work from every pane.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat)
        return;
      const state = getState();
      // Do not stack global navigation on top of a modal surface.
      if (state.settingsOpen || state.paletteOpen) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        actions.setPaletteOpen(true);
      } else if (key === 'n') {
        event.preventDefault();
        void actions.newConversation(getState().activeScopeId);
        actions.setNav('chat');
      } else if (key === 'b') {
        event.preventDefault();
        actions.setContextOpen(!getState().contextOpen);
      } else if (key === ',') {
        event.preventDefault();
        actions.setSettingsOpen(true);
      } else if (key === '1') {
        event.preventDefault();
        actions.setNav('chat');
      } else if (key === '2') {
        event.preventDefault();
        actions.setNav('goals');
      } else if (key === '3') {
        event.preventDefault();
        actions.setNav('inbox');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    // Warm the lazy chunks once the shell has painted so first navigation,
    // context pane, settings, and palette opens never wait on a chunk fetch.
    const warm = () => {
      void import('./components/ChatView');
      void import('./components/NavViews');
      void import('./components/ContextPane');
      void import('./components/SettingsDialog');
      void import('./components/CommandPalette');
    };
    const id = window.requestIdleCallback(warm, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  const paneSpring = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.7 };

  return (
    <IconProvider>
      <TooltipProvider delay={400}>
        <div
          aria-label="Tian Agent"
          className="flex h-screen overflow-hidden bg-background text-foreground"
        >
          {loading || (error && runtimeStatus !== 'ready') ? (
            <BootScreen error={error} />
          ) : (
            <>
              <motion.div
                initial={false}
                animate={{ width: navWidth }}
                transition={
                  reduce || navDragging
                    ? { duration: 0 }
                    : { duration: 0.18, ease: EASE }
                }
                className="flex min-h-0 shrink-0 overflow-hidden"
              >
                <Sidebar />
              </motion.div>
              <PaneDivider
                side="left"
                label="Resize navigation"
                width={navWidth}
                min={200}
                max={380}
                onResize={setNavWidth}
                onDraggingChange={setNavDragging}
              />
              <motion.div
                layout={!reduce}
                transition={paneSpring}
                className="relative flex min-h-0 min-w-0 flex-1 flex-col"
              >
                <AnimatePresence initial={false}>
                  {(operationError ||
                    runtimeStatus === 'starting' ||
                    runtimeStatus === 'disconnected') && (
                    <motion.div
                      key="banner"
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <div
                        role={operationError ? 'alert' : 'status'}
                        className="flex items-start gap-2.5 border-border border-b bg-surface-secondary/40 px-4 py-2"
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-tertiary ${
                            operationError
                              ? 'text-destructive-foreground'
                              : 'text-content-secondary'
                          }`}
                        >
                          {operationError ? (
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
                            {operationError
                              ? '操作未完成'
                              : runtimeStatus === 'disconnected'
                                ? '后台服务已断开'
                                : '正在重新连接后台服务'}
                          </p>
                          <p
                            className="mt-0.5 truncate font-mono text-[10px] text-content-secondary"
                            title={
                              operationError ??
                              (runtimeStatus === 'disconnected'
                                ? '任务继续在后台运行'
                                : '正在重新连接后台服务…')
                            }
                          >
                            {operationError ??
                              (runtimeStatus === 'disconnected'
                                ? '任务继续在后台运行。重新连接后可继续查看。'
                                : '正在重新连接后台服务…')}
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
                        {operationError && (
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
                    </motion.div>
                  )}
                </AnimatePresence>
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
                    ) : (
                      <Suspense fallback={null}>
                        <InboxView />
                      </Suspense>
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
              <AnimatePresence initial={false} mode="popLayout">
                {contextOpen ? (
                  <motion.div
                    key="context"
                    initial={reduce ? false : { width: 0, opacity: 0 }}
                    animate={{ width: contextWidth + 2, opacity: 1 }}
                    exit={reduce ? undefined : { width: 0, opacity: 0 }}
                    transition={
                      reduce || contextDragging
                        ? { duration: 0 }
                        : { duration: 0.24, ease: EASE }
                    }
                    className="flex min-h-0 shrink-0 overflow-hidden"
                  >
                    <PaneDivider
                      side="right"
                      label="Resize context pane"
                      width={contextWidth}
                      min={280}
                      max={640}
                      onResize={setContextWidth}
                      onDraggingChange={setContextDragging}
                    />
                    <div
                      style={{ width: contextWidth }}
                      className="flex min-h-0"
                    >
                      <Suspense fallback={null}>
                        <ContextPane />
                      </Suspense>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="rail"
                    initial={reduce ? false : { width: 0, opacity: 0 }}
                    animate={{ width: 44, opacity: 1 }}
                    exit={reduce ? undefined : { width: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="flex shrink-0 flex-col items-center overflow-hidden border-border border-l bg-sidebar py-2"
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
            </>
          )}
          <DeferredSettingsDialog />
          <DeferredCommandPalette />
        </div>
      </TooltipProvider>
    </IconProvider>
  );
}
