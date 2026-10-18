import { useState } from 'react';
import { Settings } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import type { ScopeInfo } from '@/shared/types';
import { actions } from '../store';

export function ProjectSettingsDialog({ scope }: { scope: ScopeInfo }) {
  const s = scope.settings;
  const [autoLand, setAutoLand] = useState(s?.autoLand ?? false);
  const [agentKind, setAgentKind] = useState(s?.agentKind ?? 'durable-worker');
  const [timeoutMin, setTimeoutMin] = useState(String(s?.runTimeoutMin ?? 30));
  const [baseBranch, setBaseBranch] = useState(s?.baseBranch ?? 'main');
  const [preamble, setPreamble] = useState(s?.promptPreamble ?? '');

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Settings for ${scope.name}`}
          />
        }
      >
        <Settings className="size-3.5" />
      </DialogTrigger>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{scope.name} settings</DialogTitle>
          <DialogDescription>{scope.rootPath}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3">
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="proj-autoland"
          >
            <Checkbox
              id="proj-autoland"
              aria-label="Auto-land finished runs"
              checked={autoLand}
              onCheckedChange={(c) => setAutoLand(c === true)}
            />
            Auto-land runs when they finish (merge without asking)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <span className="font-medium text-xs text-muted-foreground">
                Agent kind
              </span>
              <Input
                aria-label="Agent kind"
                value={agentKind}
                onChange={(e) => setAgentKind(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="font-medium text-xs text-muted-foreground">
                Run timeout (min)
              </span>
              <Input
                aria-label="Run timeout minutes"
                type="number"
                min={1}
                value={timeoutMin}
                onChange={(e) => setTimeoutMin(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="font-medium text-xs text-muted-foreground">
              Base branch
            </span>
            <Input
              aria-label="Base branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="font-medium text-xs text-muted-foreground">
              Worker prompt preamble
            </span>
            <Textarea
              aria-label="Worker prompt preamble"
              value={preamble}
              onChange={(e) => setPreamble(e.target.value)}
              placeholder="Extra instructions appended to every dispatched worker…"
              className="min-h-20"
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose
            render={<Button aria-label={`Save settings for ${scope.name}`} />}
            onClick={() =>
              void actions.updateProject(scope.id, {
                autoLand: autoLand ? 1 : 0,
                agentKind: agentKind.trim() || 'durable-worker',
                runTimeoutMin: Math.max(1, Number(timeoutMin) || 30),
                baseBranch: baseBranch.trim() || 'main',
                promptPreamble: preamble,
              })
            }
          >
            Save
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
