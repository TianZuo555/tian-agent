import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { actions, useStore } from '../store';

const PROVIDERS = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'DeepSeek', value: 'deepseek' },
];

export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const open = useStore((s) => s.settingsOpen);
  const [provider, setProvider] = useState(
    settings?.model.provider ?? 'anthropic',
  );
  const [modelId, setModelId] = useState(settings?.model.modelId ?? '');

  return (
    <Dialog open={open} onOpenChange={(o) => actions.setSettingsOpen(o)}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Model used by new steward conversations.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="font-medium text-xs text-muted-foreground">
              Provider
            </span>
            <Select
              items={PROVIDERS}
              value={
                PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0]
              }
              onValueChange={(v) => setProvider((v as { value: string }).value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectPopup>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="font-medium text-xs text-muted-foreground">
              Model ID
            </span>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="claude-sonnet-5-5"
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            API keys are read from the environment (ANTHROPIC_AUTH_TOKEN /
            OPENAI_API_KEY / DEEPSEEK_API_KEY). Existing conversations keep the
            model they were created with.
          </p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            onClick={async () => {
              await actions.setModel(provider, modelId);
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
