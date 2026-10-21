import { lazy, Suspense, type ComponentProps } from 'react';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Check,
  CircleNotch,
  Copy,
  CornersOut,
  DownloadSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { defaultComponents, Streamdown, type ExtraProps } from 'streamdown';
import { cn } from '@/lib/utils';

// Pele adds ~400 KB; load it only when a diagram actually shows up.
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

/**
 * Prose styling for Streamdown output. Streamdown ships its own Tailwind
 * classes, so these selectors need to be specific enough to win without
 * fighting its component structure.
 */
const PROSE = [
  'text-[13.5px] leading-[1.75] text-foreground',
  '[&_p]:my-0 [&_p+p]:mt-3',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ul]:list-outside [&_ul_li]:pl-0 [&_ul_li]:py-0.5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:list-outside',
  '[&_li]:my-0 [&_li>p]:inline',
  '[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_h1]:mt-4 [&_h1]:mb-1 [&_h1]:font-semibold [&_h1]:text-base',
  '[&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-[15px]',
  '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-sm',
  '[&_hr]:my-4 [&_hr]:border-border',
  '[&_blockquote]:my-3 [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-content-secondary',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12.5px]',
  '[&_th]:border [&_th]:border-border [&_th]:bg-secondary [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_[data-streamdown=code-block]]:my-3 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:border [&_[data-streamdown=code-block]]:border-border',
  '[&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-secondary [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5',
].join(' ');

/** Streamdown's built-in controls, re-drawn with the app's icon family. */
function streamIcon(IconComponent: Icon) {
  return function StreamIcon(
    props: React.SVGProps<SVGSVGElement> & { size?: number },
  ) {
    return <IconComponent {...props} />;
  };
}

const STREAM_ICONS = {
  CheckIcon: streamIcon(Check),
  CopyIcon: streamIcon(Copy),
  DownloadIcon: streamIcon(DownloadSimple),
  ExternalLinkIcon: streamIcon(ArrowSquareOut),
  Loader2Icon: streamIcon(CircleNotch),
  Maximize2Icon: streamIcon(CornersOut),
  RotateCcwIcon: streamIcon(ArrowCounterClockwise),
  XIcon: streamIcon(X),
  ZoomInIcon: streamIcon(MagnifyingGlassPlus),
  ZoomOutIcon: streamIcon(MagnifyingGlassMinus),
};

/** Render ```mermaid fences with Pele instead of a syntax-highlighted block. */
function PreBlock(props: ComponentProps<'pre'> & ExtraProps) {
  const child = Array.isArray(props.children)
    ? props.children[0]
    : props.children;
  const language = (
    (child as { props?: { className?: string } })?.props?.className ?? ''
  ).match(/language-([\w-]+)/)?.[1];
  if (language !== 'mermaid') {
    const Fallback = defaultComponents.pre;
    return <Fallback {...props} />;
  }
  const source = String(
    (child as { props?: { children?: unknown } })?.props?.children ?? '',
  ).replace(/\n$/, '');
  return (
    <Suspense fallback={null}>
      <MermaidDiagram source={source} />
    </Suspense>
  );
}

/**
 * Markdown for agent-authored prose: chat replies, and the reports and
 * notifications the chief, managers and workers post. System markers (context
 * reset, model errors) stay plain rows — this is for text with structure.
 */
export function Markdown({
  text,
  animated = false,
  streaming = false,
  className,
}: {
  text: string;
  /** Typewriter reveal; skip it for text that arrived before this render. */
  animated?: boolean;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <div data-tian-prose="" className={cn(PROSE, className)}>
      <Streamdown
        animated={animated}
        isAnimating={streaming}
        caret="circle"
        controls={{ code: { copy: true }, table: { copy: true } }}
        icons={STREAM_ICONS}
        components={{ pre: PreBlock }}
      >
        {text}
      </Streamdown>
    </div>
  );
}
