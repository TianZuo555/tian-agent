import { useMemo, useState } from 'react';
import { Check, Cpu, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from '@/components/ui/combobox';
import type { ModelInfo } from '@/shared/types';
import { actions, useStore } from '../store';

function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

interface ModelItem {
  value: string;
  label: string;
  hint: string;
  model: ModelInfo;
}

/**
 * Model picker for the header. Lists whatever the local Magpie gateway
 * exposes; the popup carries the refresh action so the header stays quiet.
 */
export function ModelPicker() {
  const catalog = useStore((s) => s.catalog);
  const settings = useStore((s) => s.settings);
  const models = catalog?.models ?? [];
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const items = useMemo<ModelItem[]>(
    () =>
      models.map((m) => ({
        value: m.id,
        label: m.name,
        hint: `${contextLabel(m.contextWindow)} ctx`,
        model: m,
      })),
    [models],
  );

  const selected =
    items.find((i) => i.value === settings?.model.modelId) ?? null;
  const offline = Boolean(catalog && !catalog.ok);

  return (
    <Combobox
      items={items}
      value={selected}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(item) => {
        const next = item as ModelItem | null;
        if (next && next.value !== settings?.model.modelId) {
          void actions.setModel('magpie', next.value);
        }
      }}
      itemToStringLabel={(item) => (item as ModelItem).label}
      isItemEqualToValue={(a, b) =>
        (a as ModelItem).value === (b as ModelItem).value
      }
    >
      <ComboboxInput
        size="sm"
        showTrigger
        startAddon={<Cpu />}
        placeholder="Model"
        aria-label="Model"
        className="w-56 [&_[data-slot=combobox-input]]:cursor-pointer [&_[data-slot=combobox-input]]:text-xs"
        readOnly
      />
      <ComboboxPopup align="end" className="w-96">
        <div className="flex items-center gap-2 border-border/70 border-b px-2.5 py-1.5">
          <span className="font-medium text-[11px] text-muted-foreground">
            Magpie
          </span>
          {offline ? (
            <Badge variant="error" size="sm">
              offline
            </Badge>
          ) : (
            <Badge variant="success" size="sm">
              {models.length} models
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Refresh model list"
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
          </Button>
        </div>
        <ComboboxEmpty>No models from Magpie</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const m = item as ModelItem;
            return (
              <ComboboxItem key={m.value} value={m}>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px]">{m.label}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {m.value} · {m.hint}
                      {m.model.reasoning ? ' · reasoning' : ''}
                    </span>
                  </div>
                  {m.value === settings?.model.modelId && (
                    <Check className="ml-auto size-3.5 shrink-0 text-foreground/70" />
                  )}
                </div>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
