import { useEffect, useId, useState } from 'react';
import { Check, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type {
  RuntimeStatusInfo,
  WorkerIntent,
  WorkerRuntimeInfo,
  WorkerSettingsInfo,
} from '@/shared/types';
import { actions, useStore } from '../store';
import { tian } from '../api';
import { useT } from '../i18n';

/** pi thinking levels, in the order the manager tools name them. */
const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const blankIntent: WorkerIntent = {
  name: '',
  runtime: 'pi',
  model: null,
  thinkingLevel: null,
  purpose: '',
};

type Option = { label: string; value: string };

function RuntimeRow({
  runtime,
  capId,
  enabled,
  cap,
  status,
  onToggle,
  onCap,
}: {
  runtime: WorkerRuntimeInfo;
  capId: string;
  enabled: boolean;
  cap: string;
  status: RuntimeStatusInfo | undefined;
  onToggle: (next: boolean) => void;
  onCap: (next: string) => void;
}) {
  const t = useT();
  const external = runtime.id !== 'pi';
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <span className="font-mono text-xs">{runtime.id}</span>
      {!external && <Badge variant="secondary">{t('workers.alwaysOn')}</Badge>}
      {external &&
        status &&
        (status.installed ? (
          <span
            className={
              status.signedIn
                ? 'text-[11px] text-muted-foreground'
                : 'text-[11px] text-destructive'
            }
          >
            {status.signedIn ? status.detail : t('workers.statusSignIn')}
          </span>
        ) : (
          <span className="text-[11px] text-destructive">
            {t('workers.statusMissing')}
          </span>
        ))}
      {external && (
        <Switch
          checked={enabled}
          // D21: only an installed, signed-in runtime can be switched on.
          disabled={!enabled && !(status?.installed && status.signedIn)}
          onCheckedChange={(value) => onToggle(value === true)}
          aria-label={t('workers.enableRuntime', { id: runtime.id })}
        />
      )}
      <label
        className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
        htmlFor={capId}
      >
        {t('workers.cap')}
        <Input
          id={capId}
          type="number"
          min={1}
          max={64}
          placeholder={t('workers.capUnset')}
          value={cap}
          onChange={(event) => onCap(event.target.value)}
          className="w-20"
        />
      </label>
    </div>
  );
}

function IntentEditor({
  id,
  editing,
  onChange,
  onSave,
  onCancel,
  modelItems,
  runtimeItems,
}: {
  id: string;
  editing: WorkerIntent;
  onChange: (next: WorkerIntent) => void;
  onSave: () => void;
  onCancel: () => void;
  modelItems: Option[];
  runtimeItems: Option[];
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-iname`}>
            {t('workers.intentName')}
          </FieldLabel>
          <Input
            id={`${id}-iname`}
            required
            value={editing.name}
            onChange={(event) =>
              onChange({ ...editing, name: event.target.value })
            }
            placeholder={t('workers.intentNamePlaceholder')}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-iruntime`}>
            {t('workers.intentRuntime')}
          </FieldLabel>
          <Select
            items={runtimeItems}
            value={{ label: editing.runtime, value: editing.runtime }}
            onValueChange={(value) =>
              onChange({
                ...editing,
                runtime: (value as { value: string } | null)?.value ?? 'pi',
              })
            }
          >
            <SelectTrigger id={`${id}-iruntime`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {runtimeItems.map((item) => (
                <SelectItem key={item.value} value={item}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-imodel`}>
            {t('workers.intentModel')}
          </FieldLabel>
          <Select
            items={[
              { label: t('workers.modelDefault'), value: '' },
              ...modelItems,
            ]}
            value={
              editing.model
                ? { label: editing.model, value: editing.model }
                : { label: t('workers.modelDefault'), value: '' }
            }
            onValueChange={(value) =>
              onChange({
                ...editing,
                model: (value as { value: string } | null)?.value ?? '',
              })
            }
          >
            <SelectTrigger id={`${id}-imodel`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem
                value={{ label: t('workers.modelDefault'), value: '' }}
              >
                {t('workers.modelDefault')}
              </SelectItem>
              {modelItems.map((item) => (
                <SelectItem key={item.value} value={item}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-ilevel`}>
            {t('workers.intentLevel')}
          </FieldLabel>
          <Select
            items={[
              { label: t('workers.levelDefault'), value: '' },
              ...THINKING_LEVELS.map((level) => ({
                label: level,
                value: level,
              })),
            ]}
            value={
              editing.thinkingLevel
                ? {
                    label: editing.thinkingLevel,
                    value: editing.thinkingLevel,
                  }
                : { label: t('workers.levelDefault'), value: '' }
            }
            onValueChange={(value) =>
              onChange({
                ...editing,
                thinkingLevel: (value as { value: string } | null)?.value ?? '',
              })
            }
          >
            <SelectTrigger id={`${id}-ilevel`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem
                value={{ label: t('workers.levelDefault'), value: '' }}
              >
                {t('workers.levelDefault')}
              </SelectItem>
              {THINKING_LEVELS.map((level) => (
                <SelectItem key={level} value={{ label: level, value: level }}>
                  {level}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-ipurpose`}>
          {t('workers.intentPurpose')}
        </FieldLabel>
        <Input
          id={`${id}-ipurpose`}
          value={editing.purpose ?? ''}
          onChange={(event) =>
            onChange({ ...editing, purpose: event.target.value })
          }
          placeholder={t('workers.intentPurposePlaceholder')}
        />
        <FieldDescription>{t('workers.intentPurposeDesc')}</FieldDescription>
      </Field>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!editing.name.trim()}
        >
          <Check size={12} aria-hidden />
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X size={12} aria-hidden />
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Settings → Workers: runtimes, concurrency caps and worker intents (M6). */
export function WorkersSection() {
  const t = useT();
  const id = useId();
  const settings = useStore((s) => s.settings);
  const providers = useStore((s) => s.providers);
  const workers = settings?.workers;
  const [maxConcurrent, setMaxConcurrent] = useState(
    String(workers?.maxConcurrent ?? 3),
  );
  const [caps, setCaps] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (workers?.runtimes ?? []).map((runtime) => [
        runtime.id,
        runtime.maxConcurrent ? String(runtime.maxConcurrent) : '',
      ]),
    ),
  );
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      (workers?.runtimes ?? []).map((runtime) => [runtime.id, runtime.enabled]),
    ),
  );
  const [intents, setIntents] = useState<WorkerIntent[]>(
    workers?.intents ?? [],
  );
  const [editing, setEditing] = useState<WorkerIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RuntimeStatusInfo>>(
    {},
  );
  const runtimeIds = (workers?.runtimes ?? [])
    .filter((runtime) => runtime.id !== 'pi')
    .map((runtime) => runtime.id)
    .join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of runtimeIds.split(',').filter(Boolean))
      void tian
        .runtimeStatus(id)
        .then((info) => {
          if (!cancelled)
            setStatuses((current) => ({ ...current, [id]: info }));
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runtimeIds]);
  if (!workers) return null;

  /** Model options across every enabled provider's catalog. */
  const modelItems = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.name || provider.id} · ${model.name}`,
        value: `${provider.id}:${model.id}`,
      })),
    );
  const runtimeItems = workers.runtimes.map((runtime) => ({
    label: runtime.id,
    value: runtime.id,
  }));

  const saveIntent = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setIntents((current) => {
      const next = current.filter((intent) => intent.name !== editing.name);
      next.push({
        name,
        runtime: editing.runtime,
        model: editing.model || null,
        thinkingLevel: editing.thinkingLevel || null,
        purpose: editing.purpose?.trim() || undefined,
      });
      return next;
    });
    setEditing(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const runtimes: WorkerRuntimeInfo[] = workers.runtimes.map((runtime) => {
        const cap = (caps[runtime.id] ?? '').trim();
        return {
          id: runtime.id,
          enabled: runtime.id === 'pi' ? true : (enabled[runtime.id] ?? true),
          maxConcurrent: cap ? Number(cap) : null,
        };
      });
      const block: WorkerSettingsInfo = {
        maxConcurrent: Number(maxConcurrent),
        runtimes,
        intents,
      };
      await actions.setWorkers(block);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor={`${id}-max`}>
          {t('workers.maxConcurrent')}
        </FieldLabel>
        <Input
          id={`${id}-max`}
          type="number"
          min={1}
          max={64}
          required
          value={maxConcurrent}
          onChange={(event) => setMaxConcurrent(event.target.value)}
          className="w-28"
        />
        <FieldDescription>{t('workers.maxConcurrentDesc')}</FieldDescription>
      </Field>

      <section
        aria-label={t('workers.runtimes')}
        className="flex flex-col gap-2"
      >
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('workers.runtimes')}
        </h3>
        {workers.runtimes.map((runtime) => (
          <RuntimeRow
            key={runtime.id}
            runtime={runtime}
            capId={`${id}-cap-${runtime.id}`}
            enabled={enabled[runtime.id] ?? true}
            cap={caps[runtime.id] ?? ''}
            status={statuses[runtime.id]}
            onToggle={(next) =>
              setEnabled((current) => ({ ...current, [runtime.id]: next }))
            }
            onCap={(next) =>
              setCaps((current) => ({ ...current, [runtime.id]: next }))
            }
          />
        ))}
        <p className="text-[11px] text-muted-foreground">
          {t('workers.runtimesDesc')}
        </p>
      </section>

      <section
        aria-label={t('workers.intents')}
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('workers.intents')}
          </h3>
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('workers.addIntent')}
              onClick={() => setEditing({ ...blankIntent })}
            >
              <Plus size={12} />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t('workers.intentsDesc')}
        </p>
        {intents.length === 0 && !editing && (
          <p className="text-xs text-muted-foreground">{t('workers.none')}</p>
        )}
        {intents.map((intent) => (
          <div
            key={intent.name}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
          >
            <span className="font-mono text-xs">{intent.name}</span>
            <span className="text-xs text-muted-foreground">
              {intent.runtime}
              {intent.model ? ` / ${intent.model}` : ''}
              {intent.thinkingLevel ? ` · ${intent.thinkingLevel}` : ''}
            </span>
            {intent.purpose && (
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {intent.purpose}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('workers.editIntent', { name: intent.name })}
                onClick={() => setEditing({ ...intent })}
              >
                <PencilSimple size={12} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('workers.removeIntent', { name: intent.name })}
                onClick={() =>
                  setIntents((current) =>
                    current.filter((entry) => entry.name !== intent.name),
                  )
                }
              >
                <Trash size={12} />
              </Button>
            </div>
          </div>
        ))}

        {editing && (
          <IntentEditor
            id={id}
            editing={editing}
            onChange={setEditing}
            onSave={saveIntent}
            onCancel={() => setEditing(null)}
            modelItems={modelItems}
            runtimeItems={runtimeItems}
          />
        )}
      </section>

      {error && (
        <div role="alert" className="text-destructive text-xs">
          {error}
        </div>
      )}
      <div>
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
