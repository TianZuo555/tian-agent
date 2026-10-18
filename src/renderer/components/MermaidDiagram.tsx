import { useEffect, useState } from 'react';
import { renderAsync, type RenderResult } from 'pele/lazy';
import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * A fenced ```mermaid block rendered by Pele. While the source does not parse
 * — which is what a fence looks like mid-stream anyway — it falls back to the
 * raw source as a plain code block, then flips to the diagram once valid.
 */
export default function MermaidDiagram({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const [rendered, setRendered] = useState<RenderResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRendered(null);
    renderAsync(source, { links: false, images: false, responsive: true })
      .then((result) => {
        if (alive) setRendered(result);
      })
      .catch(() => {
        if (alive) setRendered(null);
      });
    return () => {
      alive = false;
    };
  }, [source]);

  if (!rendered) {
    return (
      <div
        className={cn(
          'my-3 rounded-md border border-border bg-code',
          className,
        )}
      >
        <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-content-secondary">
          <WarningCircle size={12} />
          mermaid
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-content-secondary">
          {source}
        </pre>
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Mermaid diagram"
      className={cn(
        'pele-theme my-3 overflow-hidden rounded-md border border-border bg-code',
        className,
      )}
    >
      <div
        className="flex justify-center p-3 [&>svg]:max-w-full [&>svg]:h-auto"
        // Pele-generated SVG: text escaped, links/images disabled above.
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    </div>
  );
}
