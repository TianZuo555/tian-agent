import {
  ArrowsClockwise,
  DownloadSimple,
  Plugs,
  PlugsConnected,
  Power,
  ShieldCheck,
  Stop,
  Wrench,
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

const UPDATE_PHASES: Record<string, string> = {
  preparing: '准备中',
  'backed-up': '备份完成',
  starting: '检查新版',
  committed: '已完成',
  'rolled-back': '已恢复旧版',
  failed: '升级失败',
  'waiting-for-exit': '等待 App 退出',
  installing: '安装中',
  'recovery-failed': '恢复失败',
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
  const { status, error, busy } = service;
  return (
    <section
      className="grid gap-3 border-border border-t pt-4"
      aria-label="服务与升级"
    >
      <SectionHeader busy={busy} onRefresh={() => void service.run('status')} />
      <StatusCard status={status} />
      {status?.legacyService && (
        <p className="rounded-lg border border-border-warning/40 bg-warning/8 px-2.5 py-2 text-[11px] text-muted-foreground leading-relaxed">
          旧版服务需要一次迁移：先停止旧版，再安装此 App
          携带的配套服务。升级不会删除数据。
        </p>
      )}
      <ConnectionActions service={service} />
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        断开连接后，后台任务继续执行；本窗口不会自动重连。停止服务会释放进程和数据库连接。
      </p>
      <LoginToggle service={service} />
      <UpdateActions service={service} />
      {status?.lastUpdate && (
        <p className="text-[10.5px] text-muted-foreground">
          最近升级：
          {UPDATE_PHASES[status.lastUpdate.phase] ?? status.lastUpdate.phase}
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

function SectionHeader({
  busy,
  onRefresh,
}: {
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-content-secondary">
        <Wrench size={11} />
      </span>
      <h3 className="font-medium text-[12px]">服务与升级</h3>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="ml-auto text-content-secondary"
        disabled={busy}
        onClick={onRefresh}
      >
        <ArrowsClockwise
          size={11}
          className={busy ? 'animate-spin' : undefined}
        />
        刷新状态
      </Button>
    </div>
  );
}

function StatusCard({ status }: { status: DesktopStatus | null }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5">
        <StatusRow
          label="App 版本"
          value={status?.appVersion ?? '—'}
          tone="neutral"
        />
        <StatusRow
          label="后台服务"
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
          label="本窗口连接"
          value={status?.connected ? '已连接' : '已断开'}
          tone={status?.connected ? 'strong' : 'warning'}
        />
        <StatusRow
          label="配套服务版本"
          value={status?.bundledServiceVersion ?? '—'}
          tone="neutral"
        />
      </dl>
      {status?.activity && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-border/60 border-t pt-2">
          <Badge variant="outline" size="sm" className="font-mono">
            活动任务 {status.activity.tasks}
          </Badge>
          <Badge variant="outline" size="sm" className="font-mono">
            工兵 {status.activity.runs}
          </Badge>
          {status.activity.maintenance && (
            <Badge variant="warning" size="sm" className="gap-1 font-mono">
              <span className="size-1 animate-pulse rounded-full bg-warning" />
              维护中
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
    return status.legacyRunning ? '旧版运行中 · 待迁移' : '旧版已停止 · 待迁移';
  if (status.service) return `运行中 · ${status.service.serviceVersion}`;
  return status.installed ? '已停止' : '尚未安装';
}

function ConnectionActions({ service }: { service: Service }) {
  const { status, busy } = service;
  return (
    <div className="flex flex-wrap gap-1.5">
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
        {status?.connected ? '断开本窗口连接' : '连接服务'}
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
        启动服务并连接
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive-outline"
        disabled={busy || (!status?.service && !status?.legacyRunning)}
        onClick={() =>
          service.confirm({
            action: 'stop',
            title: '停止后台服务？',
            description: status?.legacyService
              ? '旧版服务没有任务空闲检查。请先确认当前工作可以暂停；停止会通过正常退出流程保存可恢复的状态，随后可安装新版配套服务。会话与 Memory 保留。'
              : '所有渠道将暂时无法使用总管。会话、任务和 Memory 会保留；重新打开 App 不会自动启动服务。正在执行的任务需要先完成。',
          })
        }
      >
        <Stop size={12} weight="fill" />
        停止服务
      </Button>
    </div>
  );
}

function LoginToggle({ service }: { service: Service }) {
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
      登录自启动：{status?.loginEnabled ? '已开启' : '已关闭'}
    </Button>
  );
}

function UpdateActions({ service }: { service: Service }) {
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
              title: status?.installed
                ? '升级配套后台服务？'
                : '安装并启动后台服务？',
              description:
                '使用此 App 携带的服务和运行时。保留现有数据；升级时短暂断开连接，数据库会先备份。正在执行的任务需要先完成。',
            })
          }
        >
          <DownloadSimple size={12} />
          {status?.installed ? '升级配套服务' : '安装并启动服务'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.canUpdateApp}
          onClick={() => void service.chooseApp()}
        >
          导入新版 App…
        </Button>
        {recoverable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void service.run('recover')}
          >
            恢复未完成升级
          </Button>
        )}
      </div>
      {!status?.canUpdateApp && (
        <p className="text-[10.5px] text-muted-foreground">
          已打包的 macOS App 支持导入并安装新版 .app。
        </p>
      )}
    </>
  );
}

function ConfirmUpdate({ service }: { service: Service }) {
  const { confirmation, confirmOpen, busy, error } = service;
  const verb =
    confirmation?.action === 'stop'
      ? '停止'
      : confirmation?.action === 'install'
        ? '安装 / 升级'
        : '升级并重启';
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
            取消
          </AlertDialogClose>
          <Button
            type="button"
            loading={busy}
            variant={
              confirmation?.action === 'stop' ? 'destructive' : 'default'
            }
            onClick={() => void service.apply()}
          >
            确认{verb}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
