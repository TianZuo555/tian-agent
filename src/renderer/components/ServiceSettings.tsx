import { useEffect, useState } from 'react';
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
import { tian } from '../api';
import type {
  AppCandidate,
  DesktopAction,
  DesktopStatus,
} from '../../shared/desktop';

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

interface Confirmation {
  action: 'stop' | 'install' | 'apply-app';
  title: string;
  description: string;
  candidate?: AppCandidate;
}
export function ServiceSettings({ active }: { active: boolean }) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void tian.desktop('status').then(
      (value) => {
        if (current) {
          setStatus(value);
          setError(null);
        }
      },
      (reason) => {
        if (current) setError(String(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [active]);
  async function run(
    action: Exclude<DesktopAction, 'choose-app' | 'apply-app' | 'cancel-app'>,
  ) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await tian.desktop(action));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  function confirm(value: Confirmation) {
    setConfirmation(value);
    setConfirmOpen(true);
  }
  async function chooseApp() {
    setBusy(true);
    setError(null);
    try {
      const candidate = await tian.desktop('choose-app');
      if (candidate)
        confirm({
          action: 'apply-app',
          candidate,
          title: `升级到 ${candidate.version}？`,
          description:
            'App 将退出并重新启动。已安装的后台服务会一起升级；系统会先备份数据库，并在启动检查失败时恢复旧版。请先保存未发送的输入。' +
            (candidate.signed
              ? ' 新版签名已验证。'
              : ' 这是本地未签名的开发版本。'),
        });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!confirmation) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        confirmation.action === 'apply-app'
          ? await tian.desktop('apply-app', confirmation.candidate!.id)
          : await tian.desktop(confirmation.action);
      setStatus(result);
      setConfirmOpen(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function closeConfirmation(open: boolean) {
    if (busy) return;
    if (!open && confirmation?.candidate) {
      try {
        await tian.desktop('cancel-app', confirmation.candidate.id);
      } catch (reason) {
        setError(String(reason));
      }
    }
    setConfirmOpen(open);
  }
  return (
    <section className="grid gap-3 border-t pt-4" aria-label="服务与升级">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-sm">服务与升级</h3>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void run('status')}
        >
          刷新状态
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">App 版本</dt>
        <dd>{status?.appVersion ?? '—'}</dd>
        <dt className="text-muted-foreground">后台服务</dt>
        <dd>
          {status?.legacyService
            ? status.legacyRunning
              ? '旧版运行中 · 待迁移'
              : '旧版已停止 · 待迁移'
            : status?.service
              ? `运行中 · ${status.service.serviceVersion}`
              : status?.installed
                ? '已停止'
                : '尚未安装'}
        </dd>
        <dt className="text-muted-foreground">本窗口连接</dt>
        <dd>{status?.connected ? '已连接' : '已断开'}</dd>
        <dt className="text-muted-foreground">配套服务版本</dt>
        <dd>{status?.bundledServiceVersion ?? '—'}</dd>
      </dl>
      {status?.legacyService && (
        <p className="text-xs text-muted-foreground">
          旧版服务需要一次迁移：先停止旧版，再安装此 App
          携带的配套服务。升级不会删除数据。
        </p>
      )}
      {status?.activity && (
        <p className="text-xs text-muted-foreground">
          活动任务 {status.activity.tasks} · 工兵 {status.activity.runs}
          {status.activity.maintenance ? ' · 维护中' : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.service}
          onClick={() => void run(status?.connected ? 'disconnect' : 'connect')}
        >
          {status?.connected ? '断开本窗口连接' : '连接服务'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            busy ||
            !status?.installed ||
            !!status.service ||
            status.legacyService
          }
          onClick={() => void run('start')}
        >
          启动服务并连接
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          disabled={busy || (!status?.service && !status?.legacyRunning)}
          onClick={() =>
            confirm({
              action: 'stop',
              title: '停止后台服务？',
              description: status?.legacyService
                ? '旧版服务没有任务空闲检查。请先确认当前工作可以暂停；停止会通过正常退出流程保存可恢复的状态，随后可安装新版配套服务。会话与 Memory 保留。'
                : '所有渠道将暂时无法使用总管。会话、任务和 Memory 会保留；重新打开 App 不会自动启动服务。正在执行的任务需要先完成。',
            })
          }
        >
          停止服务
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        断开连接后，后台任务继续执行；本窗口不会自动重连。停止服务会释放进程和数据库连接。
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="justify-self-start"
        aria-pressed={status?.loginEnabled ?? false}
        disabled={busy || !status?.installed || status.legacyService}
        onClick={() =>
          void run(status?.loginEnabled ? 'login-disable' : 'login-enable')
        }
      >
        登录自启动：{status?.loginEnabled ? '已开启' : '已关闭'}
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !status || status.legacyRunning}
          onClick={() =>
            confirm({
              action: 'install',
              title: status?.installed
                ? '升级配套后台服务？'
                : '安装并启动后台服务？',
              description:
                '使用此 App 携带的服务和运行时。保留现有数据；升级时短暂断开连接，数据库会先备份。正在执行的任务需要先完成。',
            })
          }
        >
          {status?.installed ? '升级配套服务' : '安装并启动服务'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.canUpdateApp}
          onClick={() => void chooseApp()}
        >
          导入新版 App…
        </Button>
        {status?.lastUpdate &&
          (!['committed', 'rolled-back'].includes(status.lastUpdate.phase) ||
            status.lastUpdate.message?.includes('Recover update')) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run('recover')}
            >
              恢复未完成升级
            </Button>
          )}
      </div>
      {!status?.canUpdateApp && (
        <p className="text-xs text-muted-foreground">
          已打包的 macOS App 支持导入并安装新版 .app。
        </p>
      )}
      {status?.lastUpdate && (
        <p className="text-xs text-muted-foreground">
          最近升级：
          {UPDATE_PHASES[status.lastUpdate.phase] ?? status.lastUpdate.phase}
          {status.lastUpdate.message ? ` · ${status.lastUpdate.message}` : ''}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive break-words">
          {error}
        </p>
      )}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => void closeConfirmation(open)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p
              role="alert"
              className="px-6 text-xs text-destructive break-words"
            >
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
              onClick={() => void apply()}
            >
              确认
              {confirmation?.action === 'stop'
                ? '停止'
                : confirmation?.action === 'install'
                  ? '安装 / 升级'
                  : '升级并重启'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}
