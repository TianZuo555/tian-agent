import { useId, useState } from 'react';
import { Check, Key, Plus, SignIn, Trash, X } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProviderInfo, ProviderLoginEvent } from '@/shared/types';
import { actions, useStore } from '../store';
import { useT } from '../i18n';

const KIND_OPTIONS = [
  { label: 'gateway', value: 'gateway' },
  { label: 'builtin', value: 'builtin' },
];

/** Settings → Providers: configured model providers and their credentials (D21). */
export function ProvidersSection() {
  const t = useT();
  const providers = useStore((s) => s.providers);
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <FieldDescription>{t('providers.desc')}</FieldDescription>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAdding((next) => !next);
            if (!adding) void actions.loadBuiltinProviders();
          }}
        >
          <Plus size={13} />
          {t('providers.add')}
        </Button>
      </div>
      {adding && <AddProviderForm onDone={() => setAdding(false)} />}
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} />
      ))}
    </div>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const id = useId();
  const builtinProviders = useStore((s) => s.builtinProviders);
  const [providerId, setProviderId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<{ label: string; value: string } | null>(
    KIND_OPTIONS[0],
  );
  const [baseUrl, setBaseUrl] = useState('');
  const [builtin, setBuiltin] = useState<{
    id: string;
    name: string;
    oauth: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builtinItems = builtinProviders.map((entry) => ({
    label: entry.name,
    value: entry.id,
  }));

  return (
    <form
      className="grid gap-3 rounded-xl border border-border px-3 py-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await actions.addProvider({
            id: providerId.trim(),
            name: name.trim() || undefined,
            kind: kind?.value === 'builtin' ? 'builtin' : 'gateway',
            baseUrl:
              kind?.value === 'gateway'
                ? baseUrl.trim() || undefined
                : undefined,
            builtinId: kind?.value === 'builtin' ? builtin?.id : undefined,
            enabled: true,
          });
          onDone();
        } catch (reason) {
          setError(String(reason));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`${id}-pid`}>{t('providers.id')}</FieldLabel>
        <Input
          id={`${id}-pid`}
          required
          value={providerId}
          placeholder={t('providers.idPlaceholder')}
          onChange={(event) => setProviderId(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={`${id}-name`}>{t('providers.name')}</FieldLabel>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Field>
        <FieldLabel>{t('providers.kind')}</FieldLabel>
        <Select
          items={KIND_OPTIONS}
          value={kind}
          onValueChange={(value) =>
            setKind(value as { label: string; value: string } | null)
          }
        >
          <SelectTrigger aria-label={t('providers.kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option}>
                {option.value === 'builtin'
                  ? t('providers.kind.builtin')
                  : t('providers.kind.gateway')}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      {kind?.value === 'gateway' && (
        <div className="grid gap-1.5">
          <FieldLabel htmlFor={`${id}-base`}>
            {t('providers.baseUrl')}
          </FieldLabel>
          <Input
            id={`${id}-base`}
            required
            value={baseUrl}
            placeholder="https://…/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
      )}
      {kind?.value === 'builtin' && (
        <Field>
          <FieldLabel>{t('providers.builtin')}</FieldLabel>
          <Select
            items={builtinItems}
            value={builtin ? { label: builtin.name, value: builtin.id } : null}
            onValueChange={(value) => {
              const next = value as { value: string } | null;
              setBuiltin(
                builtinProviders.find((entry) => entry.id === next?.value) ??
                  null,
              );
            }}
          >
            <SelectTrigger aria-label={t('providers.builtin')}>
              <SelectValue placeholder={t('providers.builtinChoose')} />
            </SelectTrigger>
            <SelectPopup>
              {builtinItems.map((item) => (
                <SelectItem key={item.value} value={item}>
                  {item.label}
                  <span className="ms-auto font-mono text-[10px] text-content-secondary">
                    {item.value}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      )}
      {error && (
        <div role="alert" className="text-[11px] text-destructive">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={busy}>
          <Check size={13} weight="bold" />
          {t('providers.add')}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const t = useT();
  const id = useId();
  const login = useStore((s) => s.providerLogin);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preset = provider.id === 'magpie';

  return (
    <div className="grid gap-2.5 rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {provider.name || provider.id}
          <span className="ms-2 font-mono text-[10px] text-content-secondary">
            {provider.id}
          </span>
        </span>
        <Badge variant="outline" size="sm">
          {provider.kind === 'builtin'
            ? t('providers.kind.builtin')
            : t('providers.kind.gateway')}
        </Badge>
        {preset && (
          <Badge variant="secondary" size="sm">
            {t('providers.preset')}
          </Badge>
        )}
        <label
          className="flex items-center gap-1.5 text-[11px] text-content-secondary"
          htmlFor={`${id}-enabled`}
        >
          <Checkbox
            id={`${id}-enabled`}
            checked={provider.enabled}
            onCheckedChange={(value) =>
              void actions.updateProvider(provider.id, {
                ...provider,
                enabled: value === true,
              })
            }
          />
          {t('providers.enabled')}
        </label>
        {!preset && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('providers.removeAria', { id: provider.id })}
            onClick={() => void actions.removeProvider(provider.id)}
          >
            <Trash size={12} />
          </Button>
        )}
      </div>
      {provider.kind === 'gateway' && provider.baseUrl && (
        <div className="truncate font-mono text-[10px] text-content-secondary">
          {provider.baseUrl}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        {provider.hasKey ? (
          <>
            <Badge variant="secondary" size="sm" className="font-mono">
              {provider.credentialType === 'oauth'
                ? t('providers.oauthCredential')
                : provider.keyTail}
            </Badge>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void actions.deleteProviderKey(provider.id)}
            >
              {t('providers.removeKey')}
            </Button>
          </>
        ) : (
          <span className="text-content-secondary">{t('providers.noKey')}</span>
        )}
        <Button
          size="xs"
          variant="outline"
          onClick={() => setKeyDraft(keyDraft === null ? '' : null)}
        >
          <Key size={11} />
          {provider.hasKey ? t('providers.replaceKey') : t('providers.setKey')}
        </Button>
        {provider.oauth && provider.enabled && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => actions.providerLogin(provider.id)}
          >
            <SignIn size={11} />
            {t('providers.login')}
          </Button>
        )}
      </div>
      {keyDraft !== null && (
        <form
          className="flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await actions.setProviderKey(provider.id, keyDraft);
              setKeyDraft(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          <FieldLabel htmlFor={`${id}-key`} className="sr-only">
            {t('providers.keyAria', { id: provider.id })}
          </FieldLabel>
          <Input
            id={`${id}-key`}
            type="password"
            required
            value={keyDraft}
            placeholder={t('providers.keyPlaceholder')}
            onChange={(event) => setKeyDraft(event.target.value)}
          />
          <Button size="xs" type="submit" loading={busy}>
            {t('common.save')}
          </Button>
        </form>
      )}
      {login?.providerId === provider.id && (
        <LoginPanel providerId={provider.id} />
      )}
    </div>
  );
}

function LoginEventEntry({ event }: { event: ProviderLoginEvent['event'] }) {
  const t = useT();
  if (event.type === 'auth_url')
    return (
      <div className="grid gap-0.5 text-[11px]">
        {event.instructions && <span>{event.instructions}</span>}
        <code className="break-all rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
          {event.url}
        </code>
      </div>
    );
  if (event.type === 'device_code')
    return (
      <div className="text-[11px]">
        {t('providers.deviceCode')}{' '}
        <code className="font-mono font-medium">{event.userCode}</code> ·{' '}
        {event.verificationUri}
      </div>
    );
  if (event.type === 'info' || event.type === 'progress')
    return (
      <div className="text-[11px] text-content-secondary">{event.message}</div>
    );
  if (event.type === 'error')
    return (
      <div role="alert" className="text-[11px] text-destructive">
        {event.message}
      </div>
    );
  if (event.type === 'done')
    return <div className="text-[11px]">{t('providers.loginDone')}</div>;
  return null;
}

function LoginPanel({ providerId }: { providerId: string }) {
  const t = useT();
  const id = useId();
  const login = useStore((s) => s.providerLogin);
  const [answer, setAnswer] = useState('');
  const events = login?.events ?? [];
  const prompt = [...events].reverse().find((event) => event.type === 'prompt');
  const done = events.some(
    (event) => event.type === 'done' || event.type === 'error',
  );

  return (
    <div className="grid gap-2 rounded-lg bg-secondary/40 px-2.5 py-2">
      <div role="status" className="grid gap-1.5">
        {events.map((event, index) => (
          // The login event log is append-only: the index is the stable key.
          // react-doctor-disable-next-line no-array-index-as-key
          <LoginEventEntry key={index} event={event} />
        ))}
      </div>
      {prompt && prompt.type === 'prompt' && !done && (
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim()) return;
            void actions.providerLoginAnswer(
              providerId,
              prompt.promptId,
              answer,
            );
            setAnswer('');
          }}
        >
          <FieldLabel htmlFor={`${id}-answer`} className="text-[11px]">
            {prompt.message}
          </FieldLabel>
          {prompt.options?.length ? (
            <Select
              items={prompt.options.map((option) => ({
                label: option.label,
                value: option.id,
              }))}
              value={
                answer
                  ? {
                      label:
                        prompt.options.find((option) => option.id === answer)
                          ?.label ?? answer,
                      value: answer,
                    }
                  : null
              }
              onValueChange={(value) =>
                setAnswer((value as { value: string } | null)?.value ?? '')
              }
            >
              <SelectTrigger id={`${id}-answer`}>
                <SelectValue placeholder={prompt.placeholder} />
              </SelectTrigger>
              <SelectPopup>
                {prompt.options.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={{ label: option.label, value: option.id }}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : (
            <Input
              id={`${id}-answer`}
              type={prompt.secret ? 'password' : 'text'}
              required
              value={answer}
              placeholder={prompt.placeholder}
              onChange={(event) => setAnswer(event.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button size="xs" type="submit">
              {t('providers.answer')}
            </Button>
            <Button
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => actions.providerLoginCancel(providerId)}
            >
              <X size={11} />
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      {!prompt && !done && (
        <div className="flex items-center justify-between text-[11px] text-content-secondary">
          {t('providers.loginWaiting')}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => actions.providerLoginCancel(providerId)}
          >
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
