import { useId, useState } from 'react';
import { Gear } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProviderInfo, ScopeInfo, WorkerIntent } from '@/shared/types';
import { actions, useStore } from '../store';
import { useT } from '../i18n';

interface SandboxValues {
  enabled: boolean;
  network: boolean;
  extraWrite: string;
  allowRead: string;
}

function readSandbox(scope: ScopeInfo): SandboxValues {
  return {
    enabled: scope.settings?.sandboxMode !== 'off',
    network: scope.settings?.sandboxNetwork ?? true,
    extraWrite: scope.settings?.sandboxExtraWrite ?? '',
    allowRead: scope.settings?.sandboxAllowRead ?? '',
  };
}

function SandboxFields({
  id,
  value,
  onChange,
}: {
  id: string;
  value: SandboxValues;
  onChange: (next: SandboxValues) => void;
}) {
  const t = useT();
  return (
    <>
      <label
        className="flex items-center gap-2 text-sm"
        htmlFor={`${id}-sandbox`}
      >
        <Checkbox
          id={`${id}-sandbox`}
          checked={value.enabled}
          onCheckedChange={(next) =>
            onChange({ ...value, enabled: next === true })
          }
        />
        {t('project.sandbox')}
      </label>
      {!value.enabled && (
        <p className="text-destructive text-xs">
          {t('project.sandboxOffWarning')}
        </p>
      )}
      <label
        className="flex items-center gap-2 text-sm"
        htmlFor={`${id}-sandbox-network`}
      >
        <Checkbox
          id={`${id}-sandbox-network`}
          checked={value.network}
          disabled={!value.enabled}
          onCheckedChange={(next) =>
            onChange({ ...value, network: next === true })
          }
        />
        {t('project.sandboxNetwork')}
      </label>
      <label
        className="grid gap-1.5 text-xs text-muted-foreground"
        htmlFor={`${id}-sandbox-write`}
      >
        {t('project.sandboxExtraWrite')}
        <Input
          id={`${id}-sandbox-write`}
          disabled={!value.enabled}
          value={value.extraWrite}
          onChange={(event) =>
            onChange({ ...value, extraWrite: event.target.value })
          }
        />
      </label>
      <label
        className="grid gap-1.5 text-xs text-muted-foreground"
        htmlFor={`${id}-sandbox-read`}
      >
        {t('project.sandboxAllowRead')}
        <Input
          id={`${id}-sandbox-read`}
          disabled={!value.enabled}
          value={value.allowRead}
          onChange={(event) =>
            onChange({ ...value, allowRead: event.target.value })
          }
        />
      </label>
    </>
  );
}

function ManagerModelSelect({
  id,
  providers,
  value,
  onChange,
}: {
  id: string;
  providers: ProviderInfo[];
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const items = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.name || provider.id} · ${model.name}`,
        value: `${provider.id}:${model.id}`,
      })),
    );
  return (
    <label
      className="grid gap-1.5 text-xs text-muted-foreground"
      htmlFor={`${id}-manager-model`}
    >
      {t('project.managerModel')}
      <Select
        items={[
          { label: t('project.managerModelDefault'), value: '' },
          ...items,
        ]}
        value={
          value
            ? { label: value, value }
            : { label: t('project.managerModelDefault'), value: '' }
        }
        onValueChange={(next) =>
          onChange((next as { value: string } | null)?.value ?? '')
        }
      >
        <SelectTrigger id={`${id}-manager-model`}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem
            value={{ label: t('project.managerModelDefault'), value: '' }}
          >
            {t('project.managerModelDefault')}
          </SelectItem>
          {items.map((item) => (
            <SelectItem key={item.value} value={item}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <span>{t('project.managerModelHint')}</span>
    </label>
  );
}

function DefaultIntentSelect({
  id,
  intents,
  value,
  onChange,
}: {
  id: string;
  intents: WorkerIntent[];
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  return (
    <label
      className="grid gap-1.5 text-xs text-muted-foreground"
      htmlFor={`${id}-default-intent`}
    >
      {t('project.defaultIntent')}
      <Select
        items={[
          { label: t('project.defaultIntentNone'), value: '' },
          ...intents.map((intent) => ({
            label: intent.name,
            value: intent.name,
          })),
        ]}
        value={
          value
            ? { label: value, value }
            : { label: t('project.defaultIntentNone'), value: '' }
        }
        onValueChange={(next) =>
          onChange((next as { value: string } | null)?.value ?? '')
        }
      >
        <SelectTrigger id={`${id}-default-intent`}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem
            value={{ label: t('project.defaultIntentNone'), value: '' }}
          >
            {t('project.defaultIntentNone')}
          </SelectItem>
          {intents.map((intent) => (
            <SelectItem
              key={intent.name}
              value={{ label: intent.name, value: intent.name }}
            >
              {intent.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <span>{t('project.defaultIntentHint')}</span>
    </label>
  );
}

export function ProjectSettingsDialog({ scope }: { scope: ScopeInfo }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLand, setAutoLand] = useState(scope.settings?.autoLand ?? false);
  const [allowInPlace, setAllowInPlace] = useState(
    scope.settings?.allowInPlace ?? false,
  );
  const [timeoutMin, setTimeoutMin] = useState(
    String(scope.settings?.runTimeoutMin ?? 0),
  );
  const [baseBranch, setBaseBranch] = useState(
    scope.settings?.baseBranch ?? 'main',
  );
  const [preamble, setPreamble] = useState(
    scope.settings?.promptPreamble ?? '',
  );
  const [managerName, setManagerName] = useState(scope.managerName ?? '');
  const [managerModel, setManagerModel] = useState(
    scope.settings?.managerModel ?? '',
  );
  const [defaultIntent, setDefaultIntent] = useState(
    scope.settings?.defaultIntent ?? '',
  );
  const [sandbox, setSandbox] = useState<SandboxValues>(() =>
    readSandbox(scope),
  );
  const providers = useStore((s) => s.providers);
  const intents = useStore((s) => s.settings?.workers.intents ?? []);
  const t = useT();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) {
          setAutoLand(scope.settings?.autoLand ?? false);
          setAllowInPlace(scope.settings?.allowInPlace ?? false);
          setTimeoutMin(String(scope.settings?.runTimeoutMin ?? 0));
          setBaseBranch(scope.settings?.baseBranch ?? 'main');
          setPreamble(scope.settings?.promptPreamble ?? '');
          setManagerName(scope.managerName ?? '');
          setManagerModel(scope.settings?.managerModel ?? '');
          setDefaultIntent(scope.settings?.defaultIntent ?? '');
          setSandbox(readSandbox(scope));
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('project.settingsAria', { name: scope.name })}
          />
        }
      >
        <Gear size={13} />
      </DialogTrigger>
      <DialogPopup className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand/12 text-brand">
              <Gear size={14} />
            </span>
            {t('project.settingsTitle', { name: scope.name })}
          </DialogTitle>
          <DialogDescription>{scope.rootPath}</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await actions.updateProject(scope.id, {
                autoLand,
                allowInPlace,
                runTimeoutMin: Number(timeoutMin),
                baseBranch: baseBranch.trim(),
                promptPreamble: preamble,
                managerName: managerName.trim(),
                managerModel: managerModel || null,
                defaultIntent: defaultIntent || null,
                sandboxMode: sandbox.enabled ? 'workspace-write' : 'off',
                sandboxNetwork: sandbox.network,
                sandboxExtraWrite: sandbox.extraWrite,
                sandboxAllowRead: sandbox.allowRead,
              });
              setOpen(false);
            } catch (reason) {
              setError(String(reason));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogPanel className="grid gap-3">
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor={`${id}-autoland`}
            >
              <Checkbox
                id={`${id}-autoland`}
                checked={autoLand}
                onCheckedChange={(value) => setAutoLand(value === true)}
              />
              {t('project.autoLand')}
            </label>
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor={`${id}-inplace`}
            >
              <Checkbox
                id={`${id}-inplace`}
                checked={allowInPlace}
                onCheckedChange={(value) => setAllowInPlace(value === true)}
              />
              {t('project.allowInPlace')}
            </label>
            <label
              className="grid gap-1.5 text-xs text-muted-foreground"
              htmlFor={`${id}-timeout`}
            >
              {t('project.timeout')}
              <Input
                id={`${id}-timeout`}
                type="number"
                min={0}
                max={1440}
                required
                value={timeoutMin}
                onChange={(event) => setTimeoutMin(event.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                {t('project.timeoutHint')}
              </span>
            </label>
            <label
              className="grid gap-1.5 text-xs text-muted-foreground"
              htmlFor={`${id}-base-branch`}
            >
              {t('project.baseBranch')}
              <Input
                id={`${id}-base-branch`}
                required
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
              />
            </label>
            <label
              className="grid gap-1.5 text-xs text-muted-foreground"
              htmlFor={`${id}-preamble`}
            >
              {t('project.preamble')}
              <Input
                id={`${id}-preamble`}
                value={preamble}
                onChange={(event) => setPreamble(event.target.value)}
              />
            </label>
            <label
              className="grid gap-1.5 text-xs text-muted-foreground"
              htmlFor={`${id}-manager-name`}
            >
              {t('project.managerName')}
              <Input
                id={`${id}-manager-name`}
                value={managerName}
                maxLength={200}
                required
                placeholder={t('project.managerNamePlaceholder')}
                aria-describedby={`${id}-manager-name-hint`}
                onChange={(event) => setManagerName(event.target.value)}
              />
              <span id={`${id}-manager-name-hint`}>
                {t('project.managerNameHint')}
              </span>
            </label>
            <ManagerModelSelect
              id={id}
              providers={providers}
              value={managerModel}
              onChange={setManagerModel}
            />
            <DefaultIntentSelect
              id={id}
              intents={intents}
              value={defaultIntent}
              onChange={setDefaultIntent}
            />
            <SandboxFields id={id} value={sandbox} onChange={setSandbox} />
            {error && (
              <div role="alert" className="text-destructive text-xs">
                {error}
              </div>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="ghost" disabled={busy} />}
            >
              {t('common.cancel')}
            </DialogClose>
            <Button
              type="submit"
              disabled={busy}
              aria-label={t('project.saveAria', { name: scope.name })}
            >
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
