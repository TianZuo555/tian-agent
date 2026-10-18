import { useEffect, useState } from 'react';
import { actions, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { RightPanel } from './components/RightPanel';
import { SettingsDialog } from './components/SettingsDialog';

export function App() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const [init, setInit] = useState(false);

  useEffect(() => {
    if (!init) {
      setInit(true);
      void actions.init();
    }
  }, [init]);

  return (
    <div
      role="application"
      aria-label="Tian Agent"
      className="dark flex h-screen bg-background text-foreground"
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-destructive text-sm">
          {error}
        </div>
      ) : (
        <>
          <Sidebar />
          <ChatView />
          <RightPanel />
        </>
      )}
      <SettingsDialog />
    </div>
  );
}
