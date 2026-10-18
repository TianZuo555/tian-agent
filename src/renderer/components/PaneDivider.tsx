import { useCallback, useEffect, useRef, useState } from 'react';

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
  label,
}: {
  /** Which pane the divider resizes: the one to its left or right. */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const start = useRef({ x: 0, width });

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const delta =
        side === 'left'
          ? e.clientX - start.current.x
          : start.current.x - e.clientX;
      onResize(clamp(start.current.width + delta));
    };
    const onUp = () => setDragging(false);
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
  }, [dragging, side, clamp, onResize]);

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
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft')
          onResize(clamp(width + (side === 'left' ? -16 : 16)));
        if (e.key === 'ArrowRight')
          onResize(clamp(width + (side === 'left' ? 16 : -16)));
      }}
      className="group relative z-10 -mx-px w-0.5 shrink-0 cursor-col-resize bg-border outline-none focus-visible:bg-ring"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 -inset-x-1.5 transition-colors ${
          active ? 'bg-ring/40' : 'bg-transparent'
        }`}
      />
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
