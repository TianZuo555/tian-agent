import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  FolderSimple,
  Monitor,
  Plus,
  Stop,
} from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';
import { actions, useStore } from '../store';
import { useT } from '../i18n';
import { EASE } from './motion-primitives';

/** Send ⇄ stop button pair that cross-fades as the run starts and ends. */
function SendOrStop({
  busy,
  disabled,
  canSend,
  reduce,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  canSend: boolean;
  reduce: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const transition = { duration: 0.16, ease: EASE };
  return (
    <div className="relative flex size-8 shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {busy ? (
          <motion.div
            key="stop"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
            transition={transition}
          >
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={t('composer.stop')}
              disabled={disabled}
              className="relative overflow-visible"
              onClick={onStop}
            >
              <span className="absolute inset-0 animate-pulse-ring rounded-md border border-warning/40" />
              <Stop size={13} weight="fill" className="relative" />
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="send"
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
            transition={transition}
          >
            <Button
              size="icon-sm"
              aria-label={t('composer.send')}
              disabled={!canSend}
              className={`transition-[opacity,filter] ${
                canSend
                  ? 'border-0 bg-brand-gradient text-brand-contrast shadow-brand hover:brightness-105 dark:hover:brightness-95'
                  : 'border-transparent bg-surface-tertiary bg-none text-content-disabled shadow-none hover:bg-surface-tertiary'
              }`}
              onClick={onSend}
            >
              <ArrowUp size={15} weight="bold" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact model picker on the composer's toolbar row. */
function ModelPicker() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const catalog = useStore((s) => s.catalog);
  const models = catalog?.models ?? [];
  if (models.length === 0) return null;
  const items = models.map((m) => ({ label: m.name, value: m.id }));
  const savedId = settings?.model.modelId ?? '';
  const current =
    items.find((i) => i.value === savedId) ??
    (savedId ? { label: savedId, value: savedId } : items[0]);
  return (
    <Select
      items={items}
      value={current}
      onValueChange={(v) => {
        const next = v as { value: string } | null;
        if (next) void actions.setModel('magpie', next.value);
      }}
    >
      <SelectTrigger
        aria-label={t('composer.model')}
        className="h-7 min-h-7 w-auto min-w-0 max-w-44 gap-1 rounded-md border-0 bg-transparent px-2 text-[11.5px] text-content-secondary shadow-none before:shadow-none hover:bg-secondary hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup side="top" align="end">
        {items.map((m) => (
          <SelectItem key={m.value} value={m}>
            <span className="truncate">{m.label}</span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * Qoder-style composer: the textarea fills the top of a carded surface and a
 * toolbar row carries the actions — new conversation on the left, model picker
 * and send/stop on the right. A status strip under the card shows the scope.
 */
export function ChatComposer({
  busy,
  disabled = false,
  value,
  onValueChange,
  onSend,
  onStop,
  placeholder,
  scopeName,
  scopeId,
  textareaRef,
}: {
  busy: boolean;
  disabled?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder?: string;
  scopeName?: string | null;
  scopeId?: string | null;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? localRef;
  const [focused, setFocused] = useState(false);
  const reduce = useReducedMotion();
  const t = useT();
  const fallbackScopeId = useStore((s) => s.activeScopeId);

  // Grow with content up to ~8 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, ref]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    onValueChange('');
  };

  const canSend = Boolean(value.trim()) && !disabled;

  return (
    <motion.div
      animate={focused && !reduce ? { y: -1 } : { y: 0 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="group/composer relative"
    >
      <div
        className={`relative flex flex-col rounded-2xl border bg-card transition-[border-color,box-shadow] duration-300 ${
          focused
            ? 'border-border-secondary shadow-sm'
            : 'border-border hover:border-border-secondary'
        }`}
      >
        <textarea
          ref={ref}
          disabled={disabled}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            disabled
              ? t('composer.waiting')
              : (placeholder ?? t('composer.placeholder'))
          }
          aria-label={t('composer.message')}
          rows={1}
          className="max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-[13.5px] leading-relaxed outline-none placeholder:text-content-disabled disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-1.5 border-border/70 border-t px-2 py-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label={t('common.newConversation')}
                  className="size-7 rounded-lg"
                  onClick={() =>
                    void actions.newConversation(scopeId ?? fallbackScopeId)
                  }
                />
              }
            >
              <Plus size={14} />
            </TooltipTrigger>
            <TooltipPopup>{t('common.newConversation')}</TooltipPopup>
          </Tooltip>
          <div className="ml-auto flex items-center gap-1">
            <ModelPicker />
            <SendOrStop
              busy={busy}
              disabled={disabled}
              canSend={canSend}
              reduce={Boolean(reduce)}
              onSend={submit}
              onStop={onStop}
            />
          </div>
        </div>
      </div>
      {scopeName && (
        <div className="mt-1.5 flex items-center gap-3 px-1 font-mono text-[10px] text-content-disabled">
          <span className="flex min-w-0 items-center gap-1">
            <FolderSimple size={11} aria-hidden className="shrink-0" />
            <span className="truncate">{scopeName}</span>
          </span>
          <span className="flex items-center gap-1">
            <Monitor size={11} aria-hidden />
            {t('composer.local')}
          </span>
          <span role="status" className="ml-auto shrink-0">
            {busy ? t('composer.working') : t('composer.ready')}
          </span>
        </div>
      )}
    </motion.div>
  );
}
