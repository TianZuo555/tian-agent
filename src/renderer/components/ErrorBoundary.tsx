import { Component, type ErrorInfo, type ReactNode } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useT } from '../i18n';
import { reportClientError } from '../report-error';

interface State {
  error: Error | null;
}

function CrashScreen({ message }: { message: string }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-8 text-center text-foreground"
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive/8 text-destructive-foreground">
        <WarningCircle size={22} />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h1 className="font-medium text-[15px]">{t('error.title')}</h1>
        <p className="break-words text-[12px] text-content-secondary leading-relaxed">
          {message}
        </p>
        <p className="text-[11px] text-content-disabled">
          {t('error.recorded')}
        </p>
      </div>
      <Button size="sm" onClick={() => window.location.reload()}>
        {t('error.reload')}
      </Button>
    </div>
  );
}

/** Keeps a render failure from blanking the window and records it for triage. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError('renderer.render', error, info.componentStack ?? '');
  }

  render(): ReactNode {
    if (this.state.error)
      return <CrashScreen message={this.state.error.message} />;
    return this.props.children;
  }
}
