import { useMemo, useState } from 'react';
import { ArrowsClockwise, Check, Cpu } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'motion/react';
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
  const reduce = useReducedMotion();

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
        startAddon={<Cpu size={13} />}
        placeholder="Model"
        aria-label="Model"
        className="w-44 bg-secondary/40 [&_[data-slot=combobox-input]]:cursor-pointer [&_[data-slot=combobox-input]]:text-[11.5px]"
        readOnly
      />
      <ComboboxPopup align="end" className="w-96">
        <div className="flex items-center gap-2 border-border/70 border-b px-2.5 py-1.5">
          <span className="flex size-4 items-center justify-center rounded bg-brand/10 text-brand">
            <Cpu size={10} weight="fill" />
          </span>
          <span className="font-medium text-[11px] text-muted-foreground">
            Magpie
          </span>
          {offline ? (
            <Badge variant="error" size="sm">
              offline
            </Badge>
          ) : (
            <Badge variant="outline" size="sm">
              {models.length} models
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-content-secondary"
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
            <ArrowsClockwise
              size={12}
              className={refreshing ? 'animate-spin' : undefined}
            />
          </Button>
        </div>
        <ComboboxEmpty>No models from Magpie</ComboboxEmpty>
        <ComboboxList>
          {(item) => {
            const m = item as ModelItem;
            const isActive = m.value === settings?.model.modelId;
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
                  {isActive && (
                    <motion.span
                      initial={reduce ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 24,
                      }}
                      className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-brand-contrast"
                    >
                      <Check size={9} weight="bold" />
                    </motion.span>
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
