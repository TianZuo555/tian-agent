import { useEffect } from 'react';
import { actions, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { RightPanel } from './components/RightPanel';
import { SettingsDialog } from './components/SettingsDialog';

export function App() {
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const operationError = useStore((s) => s.operationError);
  const runtimeStatus = useStore((s) => s.runtimeStatus);

  useEffect(() => actions.init(), []);

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
        <div className="flex min-w-0 flex-1 flex-col">
          {(operationError || runtimeStatus === 'starting') && (
            <div
              role={operationError ? 'alert' : 'status'}
              className="flex items-center gap-2 border-b px-4 py-2 text-sm"
            >
              <span
                className={
                  operationError ? 'text-destructive' : 'text-muted-foreground'
                }
              >
                {operationError ?? 'Reconnecting to the agent runtime…'}
              </span>
              {operationError && (
                <button
                  type="button"
                  className="ml-auto underline"
                  onClick={actions.clearError}
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <ChatView />
            <RightPanel />
          </div>
        </div>
      )}
      <SettingsDialog />
    </div>
  );
}
