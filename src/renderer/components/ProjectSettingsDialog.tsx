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
import type { ScopeInfo } from '@/shared/types';
import { actions } from '../store';

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
    String(scope.settings?.runTimeoutMin ?? 30),
  );
  const [baseBranch, setBaseBranch] = useState(
    scope.settings?.baseBranch ?? 'main',
  );
  const [preamble, setPreamble] = useState(
    scope.settings?.promptPreamble ?? '',
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) {
          setAutoLand(scope.settings?.autoLand ?? false);
          setAllowInPlace(scope.settings?.allowInPlace ?? false);
          setTimeoutMin(String(scope.settings?.runTimeoutMin ?? 30));
          setBaseBranch(scope.settings?.baseBranch ?? 'main');
          setPreamble(scope.settings?.promptPreamble ?? '');
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
            aria-label={`Settings for ${scope.name}`}
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
            {scope.name} settings
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
              Auto-land finished runs
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
              Allow execution in the original directory for non-Git projects
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              Run timeout (minutes)
              <Input
                aria-label="Run timeout minutes"
                type="number"
                min={1}
                max={1440}
                required
                value={timeoutMin}
                onChange={(event) => setTimeoutMin(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              Base branch
              <Input
                aria-label="Base branch"
                required
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-xs text-muted-foreground">
              Worker instructions
              <Input
                aria-label="Worker instructions"
                value={preamble}
                onChange={(event) => setPreamble(event.target.value)}
              />
            </label>
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
              Cancel
            </DialogClose>
            <Button
              type="submit"
              disabled={busy}
              aria-label={`Save settings for ${scope.name}`}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
