import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Stop } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
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

/**
 * Plain composer: a self-sizing textarea with a send button. Enter sends,
 * Shift+Enter breaks the line. No token machinery, no suggestion popup.
 */
export function ChatComposer({
  busy,
  disabled = false,
  value,
  onValueChange,
  onSend,
  onStop,
  placeholder,
  textareaRef,
}: {
  busy: boolean;
  disabled?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? localRef;
  const [focused, setFocused] = useState(false);
  const reduce = useReducedMotion();
  const t = useT();

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
        className={`relative flex flex-col rounded-2xl border bg-card/90 backdrop-blur-sm transition-[border-color,box-shadow] duration-300 ${
          focused
            ? 'border-brand/45 shadow-[0_0_0_4px_hsl(var(--brand)/0.07),0_12px_32px_-18px_hsl(var(--brand)/0.45)]'
            : 'border-border hover:border-border-secondary'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent transition-opacity duration-300 ${
            focused ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div className="flex items-end gap-1.5 p-2">
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
            className="max-h-[200px] min-h-[34px] flex-1 resize-none bg-transparent px-2.5 py-1.5 text-[13.5px] leading-relaxed outline-none placeholder:text-content-disabled disabled:cursor-not-allowed"
          />
          <SendOrStop
            busy={busy}
            disabled={disabled}
            canSend={canSend}
            reduce={Boolean(reduce)}
            onSend={submit}
            onStop={onStop}
          />
        </div>
        <motion.div
          layout={!reduce}
          transition={{ duration: 0.18, ease: EASE }}
          className="overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {focused && (
              <motion.div
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <div className="flex items-center gap-3 border-border border-t px-3.5 py-1.5 font-mono text-[10px] text-content-disabled">
                  <span className="flex items-center gap-1">
                    <Kbd className="h-4 min-w-4 px-1 text-[9px]">↵</Kbd>
                    {t('composer.sendHint')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Kbd className="h-4 min-w-4 px-1 text-[9px]">⇧↵</Kbd>
                    {t('composer.newLineHint')}
                  </span>
                  <span className="ml-auto hidden items-center gap-1 sm:flex">
                    <span className="size-1.5 rounded-full bg-content-secondary" />
                    {busy ? t('composer.working') : t('composer.ready')}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}
