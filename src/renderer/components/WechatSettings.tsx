import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, ChatCircleText } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tian } from '../api';
import { useT } from '../i18n';
import type { WechatStatus } from '../../shared/types';

/**
 * WeChat channel: the login QR code and the current binding. The service owns
 * the iLink session, so this panel only reads status and asks for a new code.
 */
export function WechatSettings({ active }: { active: boolean }) {
  const t = useT();
  const [status, setStatus] = useState<WechatStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await tian.wechatStatus());
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    // The QR login finishes in the service; poll while a scan is pending.
    const timer = setInterval(() => void refresh(), 3_000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  async function relogin() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await tian.wechatRelogin());
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3" aria-label={t('wechat.aria')}>
      <div className="rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[11px]">
          <dt className="text-muted-foreground">{t('wechat.channel')}</dt>
          <dd>
            {t(status?.enabled ? 'wechat.configured' : 'wechat.notConfigured')}
          </dd>
          <dt className="text-muted-foreground">{t('wechat.session')}</dt>
          <dd>
            {t(status?.loggedIn ? 'wechat.connected' : 'wechat.signedOut')}
          </dd>
          {status?.accountId && (
            <>
              <dt className="text-muted-foreground">{t('wechat.account')}</dt>
              <dd className="font-mono break-all">{status.accountId}</dd>
            </>
          )}
        </dl>
      </div>

      {status?.qrCodeUrl ? (
        <div className="grid gap-2 rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
          <p className="text-[11px] font-medium">{t('wechat.scanTitle')}</p>
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            {t('wechat.scanHint')}
          </p>
          <a
            className="text-[11px] break-all underline underline-offset-2"
            href={status.qrCodeUrl}
            target="_blank"
            rel="noreferrer"
          >
            {status.qrCodeUrl}
          </a>
          {status.scanned && (
            <Badge variant="outline" size="sm" className="justify-self-start">
              {t('wechat.scanned')}
            </Badge>
          )}
        </div>
      ) : (
        <p className="text-[10.5px] text-muted-foreground leading-relaxed">
          {t('wechat.allowlistNote')}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-content-secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowsClockwise size={12} />
          {t('service.refresh')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !status?.enabled}
          onClick={() => void relogin()}
        >
          <ChatCircleText size={12} />
          {t('wechat.relogin')}
        </Button>
      </div>

      <p className="text-[10.5px] text-muted-foreground leading-relaxed">
        {t('wechat.keepaliveNote')}
      </p>

      {error && (
        <p role="alert" className="text-[11px] text-destructive break-words">
          {error}
        </p>
      )}
      {status?.error && (
        <p role="status" className="text-[11px] text-destructive break-words">
          {status.error}
        </p>
      )}
    </section>
  );
}
