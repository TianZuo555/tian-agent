import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Plain composer: a self-sizing textarea with a send button. Enter sends,
 * Shift+Enter breaks the line. No token machinery, no suggestion popup.
 */
export function ChatComposer({
  busy,
  disabled = false,
  onSend,
  onStop,
  placeholder = 'Message the steward…',
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to ~8 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  return (
    <div className="relative flex items-end gap-1 rounded-xl border border-border bg-card p-1.5 transition-colors focus-within:border-border-secondary">
      <textarea
        ref={ref}
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        aria-label="Message"
        rows={1}
        className="max-h-[200px] min-h-[32px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-relaxed outline-none placeholder:text-content-disabled"
      />
      {busy ? (
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Stop"
          disabled={disabled}
          onClick={onStop}
        >
          <Square className="size-3.5" />
        </Button>
      ) : (
        <Button
          size="icon-sm"
          aria-label="Send"
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </div>
  );
}
