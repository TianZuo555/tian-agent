import { useEffect, useState } from 'react';
import { tian } from '../api';
import type {
  AppCandidate,
  DesktopAction,
  DesktopStatus,
} from '../../shared/desktop';

export interface Confirmation {
  action: 'stop' | 'install' | 'apply-app';
  title: string;
  description: string;
  candidate?: AppCandidate;
}

/**
 * Desktop service state and every action that mutates it. Kept out of the
 * settings view so each panel only renders.
 */
export function useServiceStatus(active: boolean) {
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
        if (!current) return;
        setStatus(value);
        setError(null);
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
      if (!candidate) return;
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

  return {
    status,
    error,
    busy,
    confirmation,
    confirmOpen,
    run,
    confirm,
    chooseApp,
    apply,
    closeConfirmation,
  };
}
