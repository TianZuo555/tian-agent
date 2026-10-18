import { useState } from 'react';
import {
  ArrowsClockwise,
  ChartBar,
  Check,
  Cpu,
  Gear,
  Pulse,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription } from '@/components/ui/field';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { actions, useStore } from '../store';
import { UsageHeatmap } from './UsageHeatmap';
import { ServiceSettings } from './ServiceSettings';

function SectionTitle({
  icon: IconComponent,
  label,
  trailing,
}: {
  icon: typeof Cpu;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-content-secondary">
        <IconComponent size={11} />
      </span>
      <span className="font-medium text-[12px]">{label}</span>
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </div>
  );
}

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const catalog = useStore((s) => s.catalog);
  const open = useStore((s) => s.settingsOpen);
  const [modelId, setModelId] = useState(settings?.model.modelId ?? '');
  const [refreshing, setRefreshing] = useState(false);

  const models = catalog?.models ?? [];
  const items = models.map((m) => ({ label: m.name, value: m.id }));
  const current =
    items.find((i) => i.value === modelId) ??
    (modelId ? { label: modelId, value: modelId } : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setModelId(settings?.model.modelId ?? '');
        actions.setSettingsOpen(o);
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand/12 text-brand">
              <Gear size={16} />
            </span>
            <span className="flex flex-col gap-0.5">
              Settings
              <span className="font-normal font-mono text-[9.5px] text-content-disabled uppercase tracking-[0.12em]">
                local service · magpie
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Models, usage, and local service controls.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-5">
          <section aria-label="Gateway">
            <SectionTitle
              icon={Pulse}
              label="Gateway"
              trailing={
                <Badge
                  variant={catalog?.ok ? 'outline' : 'error'}
                  size="sm"
                  className="gap-1 font-mono"
                >
                  <span
                    className={`size-1 rounded-full ${
                      catalog?.ok ? 'bg-foreground' : 'bg-destructive'
                    }`}
                  />
                  {catalog?.ok ? 'online' : 'offline'}
                </Badge>
              }
            />
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-3 py-2.5">
              <span className="relative flex size-2 shrink-0">
                {catalog?.ok && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-foreground opacity-30" />
                )}
                <span
                  aria-hidden="true"
                  className={`relative size-2 rounded-full ${catalog?.ok ? 'bg-foreground' : 'bg-destructive'}`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px]">
                  {catalog?.ok ? 'Magpie connected' : 'Magpie unreachable'}
                </div>
                <div className="truncate font-mono text-[10px] text-content-secondary">
                  {catalog?.baseUrl}
                  {catalog?.message ? ` · ${catalog.message}` : ''}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await actions.refreshModels();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <ArrowsClockwise
                  size={12}
                  className={refreshing ? 'animate-spin' : undefined}
                />
                Refresh
              </Button>
            </div>
          </section>

          <section aria-label="Model">
            <SectionTitle
              icon={Cpu}
              label="Model"
              trailing={
                <span className="font-mono text-[9.5px] text-content-disabled">
                  {models.length} available
                </span>
              }
            />
            <Field>
              <Select
                items={items}
                value={current}
                onValueChange={(v) => {
                  const next = v as { value: string } | null;
                  if (next) setModelId(next.value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectPopup>
                  {items.map((m) => (
                    <SelectItem key={m.value} value={m}>
                      <span className="truncate">{m.label}</span>
                      <span className="ms-auto truncate font-mono text-[10px] text-content-secondary">
                        {m.value}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <FieldDescription>
                New conversations use the selected model; existing ones keep the
                model they started with.
              </FieldDescription>
            </Field>
          </section>

          <section aria-label="Gateway override">
            <div className="rounded-xl border border-border px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium text-[12px]">
                  Gateway override
                </span>
                <Badge variant="outline" size="sm" className="font-mono">
                  MAGPIE_BASE_URL
                </Badge>
              </div>
              <p className="text-[11px] text-content-secondary leading-relaxed">
                Set <code className="font-mono">MAGPIE_BASE_URL</code> and{' '}
                <code className="font-mono">MAGPIE_API_KEY</code> to point at a
                different gateway. Defaults to{' '}
                <code className="font-mono">http://127.0.0.1:3425/v1</code>.
              </p>
            </div>
          </section>

          <section aria-label="Usage">
            <SectionTitle icon={ChartBar} label="Usage" />
            <div className="rounded-xl border border-border px-3 py-2.5">
              <UsageHeatmap />
            </div>
          </section>

          <ServiceSettings active={open} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!modelId}
            onClick={async () => {
              await actions.setModel('magpie', modelId);
              actions.setSettingsOpen(false);
            }}
          >
            <Check size={13} weight="bold" />
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
