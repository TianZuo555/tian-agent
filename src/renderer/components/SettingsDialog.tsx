import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { actions, useStore } from '../store';
import { UsageHeatmap } from './UsageHeatmap';

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
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Models come from the local Magpie gateway.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${catalog?.ok ? 'bg-success' : 'bg-destructive'}`}
            />
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
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>

          <Field>
            <FieldLabel>Model</FieldLabel>
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
              {models.length} models available. New conversations use the
              selected model; existing ones keep the model they started with.
            </FieldDescription>
          </Field>

          <div className="rounded-md border border-border px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium text-[12px]">Gateway</span>
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

          <div className="grid gap-1.5 border-border border-t pt-3">
            <span className="font-medium text-[12px]">Usage</span>
            <UsageHeatmap />
          </div>
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
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
