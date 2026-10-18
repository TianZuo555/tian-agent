import { Suspense, lazy, useEffect, useState } from 'react';
import { tian } from './api';
import { PanelRight } from 'lucide-react';
import { actions, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { PaneDivider, usePersistedWidth } from './components/PaneDivider';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE } from './components/motion-primitives';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';

const ChatView = lazy(() =>
  import('./components/ChatView').then((m) => ({ default: m.ChatView })),
);
const InboxView = lazy(() =>
  import('./components/NavViews').then((m) => ({ default: m.InboxView })),
);
const ScheduleView = lazy(() =>
  import('./components/NavViews').then((m) => ({ default: m.ScheduleView })),
);
const ContextPane = lazy(() =>
  import('./components/ContextPane').then((m) => ({ default: m.ContextPane })),
);
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((m) => ({
    default: m.SettingsDialog,
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

/**
 * Three-pane shell, Cursor/Codex style: navigation, conversation, context.
 * Both dividers drag; the right pane collapses entirely.
 */
export function App() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const operationError = useStore((s) => s.operationError);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const contextOpen = useStore((s) => s.contextOpen);
  const nav = useStore((s) => s.nav);
  const reduce = useReducedMotion();
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
  useEffect(() => {
    // Warm the lazy chunks once the shell has painted so first navigation,
    // context pane, and settings opens never wait on a chunk fetch.
    const warm = () => {
      void import('./components/ChatView');
      void import('./components/NavViews');
      void import('./components/ContextPane');
      void import('./components/SettingsDialog');
    };
    const id = window.requestIdleCallback(warm, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  return (
    <TooltipProvider delay={400}>
      <div
        role="application"
        aria-label="Tian Agent"
        className="flex h-screen overflow-hidden bg-background text-foreground"
      >
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-2 font-mono text-[11px] text-content-secondary">
              <span className="size-1.5 animate-pulse rounded-full bg-content-secondary" />
              starting…
            </div>
            <Button
              variant="outline"
              onClick={() => actions.setSettingsOpen(true)}
            >
              打开服务设置
            </Button>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center text-destructive-foreground text-sm"
          >
            <p>{error}</p>
            <Button
              variant="outline"
              onClick={() => actions.setSettingsOpen(true)}
            >
              打开服务设置
            </Button>
          </div>
        ) : (
          <>
            <motion.div
              initial={false}
              animate={{ width: navWidth }}
              transition={
                reduce ? { duration: 0 } : { duration: 0.18, ease: EASE }
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
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={nav}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: EASE }}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {(operationError ||
                  runtimeStatus === 'starting' ||
                  runtimeStatus === 'disconnected') && (
                  <div
                    role={operationError ? 'alert' : 'status'}
                    className="flex items-center gap-2 border-b px-4 py-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 break-words text-muted-foreground">
                      {operationError ??
                        (runtimeStatus === 'disconnected'
                          ? '已断开后台服务连接。任务继续在后台运行。'
                          : '正在重新连接后台服务…')}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => actions.setSettingsOpen(true)}
                    >
                      服务设置
                    </Button>
                    {operationError && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={actions.clearError}
                      >
                        关闭提示
                      </Button>
                    )}
                  </div>
                )}
                {nav === 'chat' ? (
                  <Suspense fallback={null}>
                    <ChatView />
                  </Suspense>
                ) : nav === 'schedule' ? (
                  <Suspense fallback={null}>
                    <ScheduleView />
                  </Suspense>
                ) : (
                  <Suspense fallback={null}>
                    <InboxView />
                  </Suspense>
                )}
              </motion.div>
            </AnimatePresence>
            {contextOpen ? (
              <>
                <PaneDivider
                  side="right"
                  label="Resize context pane"
                  width={contextWidth}
                  min={280}
                  max={640}
                  onResize={setContextWidth}
                />
                <div
                  style={{ width: contextWidth }}
                  className="flex min-h-0 shrink-0"
                >
                  <Suspense fallback={null}>
                    <ContextPane />
                  </Suspense>
                </div>
              </>
            ) : (
              <div className="flex w-11 shrink-0 flex-col items-center border-border border-l py-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Show context pane"
                  onClick={() => actions.setContextOpen(true)}
                >
                  <PanelRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
        <DeferredSettingsDialog />
      </div>
    </TooltipProvider>
  );
}
