import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { DotsSixVertical } from '@phosphor-icons/react';

/**
 * Drag-to-resize divider between two panes. Cursor-style: a 1px hairline that
 * thickens on hover, with a wider invisible hit area so it is easy to grab.
 */
export function PaneDivider({
  side,
  width,
  min,
  max,
  onResize,
  onDraggingChange,
  label,
  quiet = false,
}: {
  /** Which pane the divider resizes: the one to its left or right. */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  label: string;
  /** No resting hairline: the pane's own edge already draws the seam. */
  quiet?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const start = useRef({ x: 0, width });

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  );
  // Read the latest props from inside the listeners without re-subscribing
  // (and without re-running the effect) on every parent render.
  const resizeTo = useEffectEvent((next: number) => onResize(clamp(next)));
  const reportDragging = useEffectEvent((value: boolean) =>
    onDraggingChange?.(value),
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const delta =
        side === 'left'
          ? e.clientX - start.current.x
          : start.current.x - e.clientX;
      resizeTo(start.current.width + delta);
    };
    const onUp = () => {
      setDragging(false);
      reportDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, side]);

  const active = dragging || hover;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, width };
        setDragging(true);
        onDraggingChange?.(true);
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft')
          onResize(clamp(width + (side === 'left' ? -16 : 16)));
        if (e.key === 'ArrowRight')
          onResize(clamp(width + (side === 'left' ? 16 : -16)));
      }}
      className={`group relative z-10 -mx-px w-0.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:bg-brand ${
        quiet ? '' : 'bg-border'
      } ${active ? 'bg-brand/50' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 -inset-x-1.5 transition-colors ${
          active ? 'bg-brand/12' : 'bg-transparent'
        }`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-1/2 left-1/2 flex h-7 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-content-disabled transition-all duration-200 ${
          active ? 'scale-100 opacity-100 shadow-sm' : 'scale-75 opacity-0'
        }`}
      >
        <DotsSixVertical size={9} className="rotate-90" />
      </span>
    </div>
  );
}

/** Persist a pane width across reloads without a store dependency. */
export function usePersistedWidth(
  key: string,
  initial: number,
  min: number,
  max: number,
): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0
      ? Math.min(max, Math.max(min, raw))
      : initial;
  });
  const update = useCallback(
    (w: number) => {
      const next = Math.min(max, Math.max(min, w));
      setWidth(next);
      localStorage.setItem(key, String(next));
    },
    [key, min, max],
  );
  return [width, update];
}
