import { Suspense, lazy, useEffect, useState } from 'react';
import { tian } from './api';
import { WarningCircle } from '@phosphor-icons/react';
import { actions, getState, useStore } from './store';
import { usePersistedWidth } from './components/PaneDivider';
import { useReducedMotion, motion } from 'motion/react';
import { EASE } from './components/motion-primitives';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IconProvider } from './components/IconProvider';
import { BrandOrb } from './components/BrandMark';
import { Shell } from './components/Shell';

const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({
    default: m.SettingsView,
  })),
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  })),
);

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
function BootScreen({
  error,
  onOpenSettings,
}: {
  error: string | null;
  onOpenSettings: () => void;
}) {
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
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          打开服务设置
        </Button>
      )}
    </div>
  );
}

const SHORTCUTS: Record<string, () => void> = {
  k: () => actions.setPaletteOpen(true),
  n: () => {
    void actions.newConversation(getState().activeScopeId);
    actions.setNav('chat');
  },
  b: () => actions.setContextOpen(!getState().contextOpen),
  ',': () => actions.toggleSettings(),
  '1': () => actions.setNav('chat'),
  '2': () => actions.setNav('goals'),
  '3': () => actions.setNav('skills'),
  '4': () => actions.setNav('inbox'),
};

/** Global navigation shortcuts; they work from every pane. */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat)
        return;
      // Do not stack global navigation on top of the command palette.
      if (getState().paletteOpen) return;
      const key = event.key.toLowerCase();
      // ⌃⌘S folds the navigation sidebar, as a Mac app's View menu does.
      if (event.metaKey && event.ctrlKey && key === 's' && !event.shiftKey) {
        event.preventDefault();
        actions.setSidebarOpen(!getState().sidebarOpen);
        return;
      }
      const run = SHORTCUTS[key];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Warm the lazy chunks once the shell has painted. */
function useWarmChunks() {
  useEffect(() => {
    const warm = () => {
      void import('./components/ChatView');
      void import('./components/NavViews');
      void import('./components/ContextPane');
      void import('./components/SettingsView');
      void import('./components/CommandPalette');
    };
    const id = window.requestIdleCallback(warm, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }, []);
}

/** Boot, then the three-pane shell. */
export function App() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const runtimeStatus = useStore((s) => s.runtimeStatus);
  const [contextDragging, setContextDragging] = useState(false);
  // Service controls must stay reachable while the service itself is down.
  const [bootSettings, setBootSettings] = useState(false);
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
  useGlobalShortcuts();
  useWarmChunks();

  const booting = loading || (Boolean(error) && runtimeStatus !== 'ready');
  return (
    <IconProvider>
      <TooltipProvider delay={400}>
        {booting && bootSettings ? (
          <div className="flex h-screen flex-col bg-background">
            <Suspense fallback={null}>
              <SettingsView onBack={() => setBootSettings(false)} />
            </Suspense>
          </div>
        ) : booting ? (
          <BootScreen
            error={error}
            onOpenSettings={() => setBootSettings(true)}
          />
        ) : (
          <Shell
            navWidth={navWidth}
            onNavResize={setNavWidth}
            contextWidth={contextWidth}
            contextDragging={contextDragging}
            onContextResize={setContextWidth}
            onContextDraggingChange={setContextDragging}
          />
        )}
        <DeferredCommandPalette />
      </TooltipProvider>
    </IconProvider>
  );
}
