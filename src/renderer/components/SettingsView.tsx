import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowsClockwise,
  ChartBar,
  Check,
  Cpu,
  Gear,
  Notebook,
  Pulse,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useReducedMotion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { ImprovementLog } from './ImprovementLog';

const SECTIONS: { id: string; label: string; icon: Icon }[] = [
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'usage', label: 'Usage', icon: ChartBar },
  { id: 'log', label: 'Log', icon: Notebook },
  { id: 'service', label: 'Service', icon: Pulse },
];

function SectionTitle({
  icon: IconComponent,
  label,
  trailing,
}: {
  icon: Icon;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-md bg-secondary text-content-secondary">
        <IconComponent size={11} />
      </span>
      <h2 className="font-medium text-[12.5px]">{label}</h2>
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </div>
  );
}

function Section({
  id,
  title,
  icon,
  trailing,
  children,
}: {
  id: string;
  title: string;
  icon: Icon;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`settings-${id}`}
      aria-label={title}
      className="scroll-mt-4 border-border border-b pb-7 last:border-b-0"
    >
      <SectionTitle icon={icon} label={title} trailing={trailing} />
      {children}
    </section>
  );
}

function ModelSection() {
  const settings = useStore((s) => s.settings);
  const catalog = useStore((s) => s.catalog);
  const savedId = settings?.model.modelId ?? '';
  // A draft stays local until saved, so a service update cannot overwrite a
  // selection the user is about to commit.
  const [draft, setDraft] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const modelId = draft ?? savedId;

  const models = catalog?.models ?? [];
  const items = models.map((m) => ({ label: m.name, value: m.id }));
  const current =
    items.find((i) => i.value === modelId) ??
    (modelId ? { label: modelId, value: modelId } : null);
  const dirty = draft !== null && draft !== savedId;

  return (
    <Section
      id="model"
      title="Model"
      icon={Cpu}
      trailing={
        <span className="font-mono text-[9.5px] text-content-disabled">
          {models.length} available
        </span>
      }
    >
      <div className="grid gap-4">
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

        <Field>
          <FieldLabel htmlFor="settings-model">Default model</FieldLabel>
          <Select
            items={items}
            value={current}
            onValueChange={(v) => {
              const next = v as { value: string } | null;
              if (next) setDraft(next.value);
            }}
          >
            <SelectTrigger id="settings-model">
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

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            loading={saving}
            disabled={!dirty}
            onClick={async () => {
              setSaving(true);
              try {
                await actions.setModel('magpie', modelId);
                setDraft(null);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Check size={13} weight="bold" />
            Save model
          </Button>
          <span role="status" className="text-[11px] text-content-secondary">
            {dirty
              ? 'Unsaved change'
              : settings
                ? `Using ${settings.model.modelId}`
                : ''}
          </span>
        </div>

        <div className="rounded-xl border border-border px-3 py-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium text-[12px]">Gateway override</span>
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
      </div>
    </Section>
  );
}

function UsageSection() {
  const scopeId = useStore((s) => s.activeScopeId);
  const scopes = useStore((s) => s.scopes);
  const [allScopes, setAllScopes] = useState(false);
  const name = scopes.find((s) => s.id === scopeId)?.name ?? scopeId;
  return (
    <Section
      id="usage"
      title="Usage"
      icon={ChartBar}
      trailing={
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <button
            type="button"
            aria-pressed={!allScopes}
            onClick={() => setAllScopes(false)}
            className={`cursor-pointer rounded-md px-2 py-1 font-medium text-[11px] transition-colors ${
              !allScopes
                ? 'bg-secondary text-foreground'
                : 'text-content-secondary hover:text-foreground'
            }`}
          >
            {name}
          </button>
          <button
            type="button"
            aria-pressed={allScopes}
            onClick={() => setAllScopes(true)}
            className={`cursor-pointer rounded-md px-2 py-1 font-medium text-[11px] transition-colors ${
              allScopes
                ? 'bg-secondary text-foreground'
                : 'text-content-secondary hover:text-foreground'
            }`}
          >
            All scopes
          </button>
        </div>
      }
    >
      <div className="rounded-xl border border-border px-3 py-2.5">
        <UsageHeatmap scopeId={allScopes ? null : scopeId} />
      </div>
    </Section>
  );
}

function LogSection() {
  const improvements = useStore((s) => s.improvements);
  const open = improvements.filter((entry) => entry.status === 'open').length;
  return (
    <Section
      id="log"
      title="Log"
      icon={Notebook}
      trailing={
        <span className="font-mono text-[9.5px] text-content-disabled">
          {open} open · {improvements.length} total
        </span>
      }
    >
      <ImprovementLog />
    </Section>
  );
}

function ServiceSection() {
  return (
    <Section id="service" title="Service" icon={Pulse}>
      <ServiceSettings active />
    </Section>
  );
}

/**
 * Full-page settings: the left rail's gear destination. `onBack` is only
 * passed from the boot screen, where no rail exists to navigate away.
 */
export function SettingsView({ onBack }: { onBack?: () => void }) {
  const openImprovements = useStore(
    (s) => s.improvements.filter((entry) => entry.status === 'open').length,
  );
  const catalog = useStore((s) => s.catalog);
  const reduce = useReducedMotion();
  const meta = useMemo(
    () =>
      `local service · ${catalog?.ok ? 'online' : 'offline'}${
        openImprovements ? ` · ${openImprovements} open` : ''
      }`,
    [catalog?.ok, openImprovements],
  );

  return (
    <main
      aria-label="Settings"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur-md [-webkit-app-region:drag]">
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary"
        >
          <Gear size={12} />
        </span>
        <h1 className="font-medium text-[13px]">Settings</h1>
        <span className="truncate font-mono text-[9.5px] text-content-disabled">
          {meta}
        </span>
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0 text-content-secondary [-webkit-app-region:no-drag]"
            onClick={onBack}
          >
            <ArrowLeft size={13} />
            Back
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="hidden w-40 shrink-0 flex-col gap-0.5 border-border border-r px-2 py-3 sm:flex"
        >
          {SECTIONS.map(({ id, label, icon: SectionIcon }) => (
            <button
              key={id}
              type="button"
              onClick={() =>
                document.getElementById(`settings-${id}`)?.scrollIntoView({
                  behavior: reduce ? 'auto' : 'smooth',
                  block: 'start',
                })
              }
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-content-secondary transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <SectionIcon size={13} className="shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <ScrollArea className="min-h-0 flex-1" scrollbarGutter scrollFade>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 py-6">
            <ModelSection />
            <UsageSection />
            <LogSection />
            <ServiceSection />
          </div>
        </ScrollArea>
      </div>
    </main>
  );
}
