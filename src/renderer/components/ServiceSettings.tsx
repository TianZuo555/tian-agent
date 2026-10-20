import {
  ArrowsClockwise,
  DownloadSimple,
  Plugs,
  PlugsConnected,
  Power,
  ShieldCheck,
  Stop,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { DesktopStatus } from '../../shared/desktop';
import { useServiceStatus } from './useServiceStatus';
import { t, useT, type MessageKey } from '../i18n';

const UPDATE_PHASES: Record<string, MessageKey> = {
  preparing: 'update.preparing',
  'backed-up': 'update.backed-up',
  starting: 'update.starting',
  committed: 'update.committed',
  'rolled-back': 'update.rolled-back',
  failed: 'update.failed',
  'waiting-for-exit': 'update.waiting-for-exit',
  installing: 'update.installing',
  'recovery-failed': 'update.recovery-failed',
};

function StatusRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'strong' | 'success' | 'warning' | 'destructive';
}) {
  const dot =
    tone === 'strong'
      ? 'bg-foreground'
      : tone === 'success'
        ? 'bg-content-secondary'
        : tone === 'warning'
          ? 'bg-warning'
          : tone === 'destructive'
            ? 'bg-destructive'
            : 'bg-content-disabled/50';
  return (
    <>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5 text-[11px]">
        <span aria-hidden="true" className={`size-1 rounded-full ${dot}`} />
        <span className="min-w-0 truncate">{value}</span>
      </dd>
    </>
  );
}

export function ServiceSettings({ active }: { active: boolean }) {
  const service = useServiceStatus(active);
  const { status, error } = service;
  const t = useT();
  return (
    <section className="grid gap-3" aria-label={t('service.aria')}>
      <StatusCard status={status} />
      {status?.legacyService && (
        <p className="rounded-lg border border-border-warning/40 bg-warning/8 px-2.5 py-2 text-[11px] text-muted-foreground leading-relaxed">
          {t('service.legacyNote')}
        </p>
      )}
      <ConnectionActions service={service} />
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {t('service.disconnectNote')}
      </p>
      <LoginToggle service={service} />
      <UpdateActions service={service} />
      {status?.lastUpdate && (
        <p className="text-[10.5px] text-muted-foreground">
          {t('service.lastUpdate')}
          {UPDATE_PHASES[status.lastUpdate.phase]
            ? t(UPDATE_PHASES[status.lastUpdate.phase])
            : status.lastUpdate.phase}
          {status.lastUpdate.message ? ` · ${status.lastUpdate.message}` : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-destructive break-words">
          {error}
        </p>
      )}
      <ConfirmUpdate service={service} />
    </section>
  );
}

type Service = ReturnType<typeof useServiceStatus>;

function StatusCard({ status }: { status: DesktopStatus | null }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5">
        <StatusRow
          label={t('service.appVersion')}
          value={status?.appVersion ?? '—'}
          tone="neutral"
        />
        <StatusRow
          label={t('service.background')}
          value={serviceLabel(status)}
          tone={
            status?.service
              ? 'strong'
              : status?.installed
                ? 'warning'
                : 'neutral'
          }
        />
        <StatusRow
          label={t('service.window')}
          value={
            status?.connected
              ? t('service.windowConnected')
              : t('service.windowDisconnected')
          }
          tone={status?.connected ? 'strong' : 'warning'}
        />
        <StatusRow
          label={t('service.bundled')}
          value={status?.bundledServiceVersion ?? '—'}
          tone="neutral"
        />
      </dl>
      {status?.activity && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-border/60 border-t pt-2">
          <Badge variant="outline" size="sm" className="font-mono">
            {t('service.activityTasks', { count: status.activity.tasks })}
          </Badge>
          <Badge variant="outline" size="sm" className="font-mono">
            {t('service.activityRuns', { count: status.activity.runs })}
          </Badge>
          {status.activity.maintenance && (
            <Badge variant="warning" size="sm" className="gap-1 font-mono">
              <span className="size-1 animate-pulse rounded-full bg-warning" />
              {t('service.maintenance')}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function serviceLabel(status: DesktopStatus | null): string {
  if (!status) return '—';
  if (status.legacyService)
    return t(
      status.legacyRunning ? 'service.legacyRunning' : 'service.legacyStopped',
    );
  if (status.service)
    return t('service.running', {
      version: status.service.serviceVersion,
    });
  return t(status.installed ? 'service.stopped' : 'service.notInstalled');
}

function ConnectionActions({ service }: { service: Service }) {
  const t = useT();
  const { status, busy } = service;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-content-secondary"
        disabled={busy}
        onClick={() => void service.run('status')}
      >
        <ArrowsClockwise
          size={12}
          className={busy ? 'animate-spin' : undefined}
        />
        {t('service.refresh')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !status?.service}
        onClick={() =>
          void service.run(status?.connected ? 'disconnect' : 'connect')
        }
      >
        {status?.connected ? <Plugs size={12} /> : <PlugsConnected size={12} />}
        {t(status?.connected ? 'service.disconnectWindow' : 'service.connect')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          busy || !status?.installed || !!status.service || status.legacyService
        }
        onClick={() => void service.run('start')}
      >
        <Power size={12} />
        {t('service.start')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive-outline"
        disabled={busy || (!status?.service && !status?.legacyRunning)}
        onClick={() =>
          service.confirm({
            action: 'stop',
            title: t('service.stopTitle'),
            description: t(
              status?.legacyService
                ? 'service.stopDescLegacy'
                : 'service.stopDesc',
            ),
          })
        }
      >
        <Stop size={12} weight="fill" />
        {t('service.stop')}
      </Button>
    </div>
  );
}

function LoginToggle({ service }: { service: Service }) {
  const t = useT();
  const { status, busy } = service;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="justify-self-start"
      aria-pressed={status?.loginEnabled ?? false}
      disabled={busy || !status?.installed || status.legacyService}
      onClick={() =>
        void service.run(
          status?.loginEnabled ? 'login-disable' : 'login-enable',
        )
      }
    >
      <ShieldCheck size={12} />
      {t('service.loginToggle', {
        state: t(status?.loginEnabled ? 'service.on' : 'service.off'),
      })}
    </Button>
  );
}

function UpdateActions({ service }: { service: Service }) {
  const t = useT();
  const { status, busy } = service;
  const recoverable =
    status?.lastUpdate &&
    (!['committed', 'rolled-back'].includes(status.lastUpdate.phase) ||
      status.lastUpdate.message?.includes('Recover update'));
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !status || status.legacyRunning}
          onClick={() =>
            service.confirm({
              action: 'install',
              title: t(
                status?.installed
                  ? 'service.installTitleUpgrade'
                  : 'service.installTitle',
              ),
              description: t('service.installDesc'),
            })
          }
        >
          <DownloadSimple size={12} />
          {t(status?.installed ? 'service.upgrade' : 'service.install')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.canUpdateApp}
          onClick={() => void service.chooseApp()}
        >
          {t('service.importApp')}
        </Button>
        {recoverable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void service.run('recover')}
          >
            {t('service.recover')}
          </Button>
        )}
      </div>
      {!status?.canUpdateApp && (
        <p className="text-[10.5px] text-muted-foreground">
          {t('service.packagedNote')}
        </p>
      )}
    </>
  );
}

function ConfirmUpdate({ service }: { service: Service }) {
  const { confirmation, confirmOpen, busy, error } = service;
  const t = useT();
  const verb = t(
    confirmation?.action === 'stop'
      ? 'service.confirmStop'
      : confirmation?.action === 'install'
        ? 'service.confirmInstall'
        : 'service.confirmApply',
  );
  return (
    <AlertDialog
      open={confirmOpen}
      onOpenChange={(open) => void service.closeConfirmation(open)}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="px-6 text-xs text-destructive break-words">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button type="button" variant="ghost" disabled={busy} />}
          >
            {t('common.cancel')}
          </AlertDialogClose>
          <Button
            type="button"
            loading={busy}
            variant={
              confirmation?.action === 'stop' ? 'destructive' : 'default'
            }
            onClick={() => void service.apply()}
          >
            {verb}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
