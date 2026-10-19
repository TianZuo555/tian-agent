import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowSquareOut,
  Brain,
  CalendarCheck,
  CaretRight,
  ChatCircleDots,
  Check,
  ChatCircleText,
  CheckCircle,
  CircleNotch,
  Copy,
  CornersOut,
  DownloadSimple,
  FileText,
  FolderSimple,
  GitMerge,
  Globe,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Pulse,
  Sparkle,
  Target,
  Terminal,
  WarningCircle,
  Wrench,
  X,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { lazy, Suspense } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { defaultComponents, Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ChatComposer } from './ChatComposer';
// Pele adds ~400 KB; load it only when a diagram actually shows up.
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));
import { MessageIn, Reveal, TypingDots, EASE } from './motion-primitives';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MessageRow, ToolCallRow } from '@/shared/messages';
import { actions, useStore } from '../store';
import { SidebarToggle } from './SidebarToggle';
import { ContextToggle } from './ContextToggle';
import { BrandMark, BrandOrb } from './BrandMark';

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

function toolIcon(name: string): Icon {
  if (/memory|brain/i.test(name)) return Brain;
  if (/search|grep|find|glob/i.test(name)) return MagnifyingGlass;
  if (/shell|bash|command|exec|terminal/i.test(name)) return Terminal;
  if (/git|diff|merge|branch/i.test(name)) return GitMerge;
  if (/http|fetch|web|browser/i.test(name)) return Globe;
  if (/goal|task|todo/i.test(name)) return Target;
  if (/file|read|write|edit|patch/i.test(name)) return FileText;
  return Wrench;
}

/** Status glyph in front of a tool name: running, failed, or done. */
function ToolStatus({ status }: { status: ToolCallRow['status'] }) {
  if (status === 'running')
    return (
      <CircleNotch size={11} className="animate-spin text-info-foreground" />
    );
  if (status === 'error')
    return (
      <WarningCircle
        size={11}
        weight="fill"
        className="text-destructive-foreground"
      />
    );
  return (
    <CheckCircle size={11} weight="fill" className="text-content-secondary" />
  );
}

/** Expanded args/output body of a tool chip. */
function ToolBody({ tool, failed }: { tool: ToolCallRow; failed: boolean }) {
  if (!tool.args && !tool.output) return null;
  return (
    <div className="border-border border-t">
      {tool.args && (
        <pre className="max-h-40 max-w-[42rem] overflow-auto bg-code px-2.5 py-1.5 whitespace-pre-wrap break-all font-mono text-[10.5px] text-content-secondary">
          {tool.args.slice(0, 2000)}
        </pre>
      )}
      {tool.output && (
        <pre
          className={`max-h-56 max-w-[42rem] overflow-auto bg-code px-2.5 py-1.5 whitespace-pre-wrap break-all font-mono text-[10.5px] ${
            failed ? 'text-destructive-foreground' : 'text-content-secondary'
          }`}
        >
          {tool.output.slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}

/** One tool call as a compact chip; expand for args and output. */
function ToolChip({ tool }: { tool: ToolCallRow }) {
  const [open, setOpen] = useState(false);
  const failed = tool.status === 'error';
  const running = tool.status === 'running';
  const expandable = Boolean(tool.args || tool.output);
  const IconComponent = toolIcon(tool.name);
  const reduce = useReducedMotion();
  const tone = failed
    ? 'border-border-destructive/40'
    : running
      ? 'border-border-sky/40'
      : 'border-border';
  const iconTone = failed
    ? 'bg-destructive/10 text-destructive-foreground'
    : running
      ? 'bg-info/10 text-info-foreground'
      : 'bg-surface-tertiary/60 text-content-secondary';
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: EASE }}
      className={`inline-flex max-w-full flex-col overflow-hidden rounded-lg border bg-secondary/50 align-top transition-colors ${tone}`}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={`group flex items-center gap-1.5 px-2 py-1.5 ${
          expandable ? 'cursor-pointer hover:bg-secondary/80' : 'cursor-default'
        }`}
      >
        <span
          className={`flex size-4.5 shrink-0 items-center justify-center rounded-[4px] ${iconTone}`}
        >
          <IconComponent size={10} weight="bold" />
        </span>
        <span className="truncate font-mono font-medium text-[10.5px] text-foreground">
          {tool.name}
        </span>
        <span className="ms-0.5 flex size-3.5 shrink-0 items-center justify-center">
          <ToolStatus status={tool.status} />
        </span>
        {expandable && (
          <CaretRight
            size={9}
            className={`shrink-0 text-content-disabled transition-transform duration-200 ${
              open ? 'rotate-90' : ''
            }`}
          />
        )}
      </button>
      <Reveal open={open}>
        <ToolBody tool={tool} failed={failed} />
      </Reveal>
    </motion.div>
  );
}

/** A round of tool calls, collapsed into a single summary line when long. */
function ToolGroup({ tools }: { tools: ToolCallRow[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.filter((t) => t.status === 'running').length;
  const failed = tools.filter((t) => t.status === 'error').length;
  const reduce = useReducedMotion();
  if (tools.length <= 2) {
    return (
      <div className="flex flex-wrap items-start gap-1.5">
        <AnimatePresence initial={false}>
          {tools.map((t) => (
            <ToolChip key={t.callId} tool={t} />
          ))}
        </AnimatePresence>
      </div>
    );
  }
  return (
    <div className="w-full">
      <motion.button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        whileTap={reduce ? undefined : { scale: 0.99 }}
        className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-2 py-1.5 text-[11px] text-content-secondary transition-colors hover:border-border-secondary hover:text-foreground"
      >
        <CaretRight
          size={9}
          className={`shrink-0 text-content-disabled transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <Wrench size={10} className="text-content-disabled" />
        <span className="font-medium">{tools.length} tool calls</span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-info-foreground">
            <CircleNotch size={9} className="animate-spin" />
            {running} running
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-destructive-foreground">
            <WarningCircle size={9} weight="fill" />
            {failed} failed
          </span>
        )}
      </motion.button>
      <Reveal open={open}>
        <div className="mt-1.5 flex flex-wrap items-start gap-1.5">
          {tools.map((t) => (
            <ToolChip key={t.callId} tool={t} />
          ))}
        </div>
      </Reveal>
    </div>
  );
}

function AssistantBubble({ row }: { row: MessageRow }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!row.text) return;
    try {
      await navigator.clipboard.writeText(row.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; leave the message untouched.
    }
  };
  return (
    <article
      aria-label="Assistant message"
      className="group/assistant flex w-full max-w-[52rem] flex-col gap-2"
    >
      <div className="flex items-center gap-2 opacity-75 transition-opacity group-hover/assistant:opacity-100">
        <span className="relative inline-flex">
          <BrandMark size="sm" />
          {row.streaming && (
            <span className="absolute -inset-1 animate-pulse-ring rounded-lg border border-brand/40" />
          )}
        </span>
        <span className="font-mono text-[9.5px] text-content-disabled uppercase tracking-[0.14em]">
          Tian
        </span>
        {row.streaming && (
          <span className="font-mono text-[9.5px] text-content-secondary">
            writing…
          </span>
        )}
        {row.text && !row.streaming && (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? 'Copied' : 'Copy message'}
            className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md text-content-disabled opacity-0 transition-[opacity,background-color,color] hover:bg-secondary hover:text-foreground group-hover/assistant:opacity-100 focus-visible:opacity-100"
          >
            {copied ? (
              <Check
                size={11}
                weight="bold"
                className="text-content-secondary"
              />
            ) : (
              <Copy size={11} />
            )}
          </button>
        )}
      </div>
      {row.toolCalls && row.toolCalls.length > 0 && (
        <ToolGroup tools={row.toolCalls} />
      )}
      {row.text && (
        <div data-tian-prose="" className={PROSE}>
          <Streamdown
            animated
            isAnimating={Boolean(row.streaming)}
            caret="circle"
            controls={{ code: { copy: true }, table: { copy: true } }}
            icons={STREAM_ICONS}
            components={{
              pre: (props) => {
                const child = Array.isArray(props.children)
                  ? props.children[0]
                  : props.children;
                const language = (
                  (child as { props?: { className?: string } })?.props
                    ?.className ?? ''
                ).match(/language-([\w-]+)/)?.[1];
                if (language !== 'mermaid') {
                  const Fallback = defaultComponents.pre;
                  return <Fallback {...props} />;
                }
                const source = String(
                  (child as { props?: { children?: unknown } })?.props
                    ?.children ?? '',
                ).replace(/\n$/, '');
                return (
                  <Suspense fallback={null}>
                    <MermaidDiagram source={source} />
                  </Suspense>
                );
              },
            }}
          >
            {row.text}
          </Streamdown>
        </div>
      )}
      {row.streaming && !row.text && (
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-content-secondary">
          <TypingDots className="text-content-secondary" />
          <span className="shimmer-text">thinking…</span>
        </div>
      )}
    </article>
  );
}

function UserBubble({ row }: { row: MessageRow }) {
  return (
    <article aria-label="User message" className="flex w-full justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-xl rounded-br-md border border-border border-b-border-secondary/70 bg-secondary px-3.5 py-2 text-[13px] text-secondary-foreground leading-relaxed shadow-[0_1px_0_hsl(0_0%_100%/0.04)_inset]">
        {row.text}
      </div>
    </article>
  );
}

function Row({ row }: { row: MessageRow }) {
  if (row.role === 'system') {
    return (
      <div
        role="separator"
        className="flex items-center gap-3 py-2 font-mono text-[9.5px] text-content-disabled uppercase tracking-[0.14em]"
      >
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
        {row.text}
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
      </div>
    );
  }
  if (row.role === 'tool') {
    return <ToolGroup tools={row.toolCalls ?? []} />;
  }
  return row.role === 'user' ? (
    <UserBubble row={row} />
  ) : (
    <AssistantBubble row={row} />
  );
}

const SUGGESTIONS: {
  icon: Icon;
  title: string;
  hint: string;
  prompt: string;
}[] = [
  {
    icon: CalendarCheck,
    title: 'Plan my day',
    hint: 'goals, tasks, and time',
    prompt:
      'Help me plan my day. Look at my active goals and tasks, then propose a short, realistic plan.',
  },
  {
    icon: Target,
    title: 'Review goals',
    hint: 'what needs attention',
    prompt:
      'Review my active goals and tell me what needs attention next, in priority order.',
  },
  {
    icon: Pulse,
    title: 'Workspace check',
    hint: 'runs and loose ends',
    prompt:
      'Check the workspace: summarize recent runs and anything that needs my attention.',
  },
];

function WelcomePane({
  scopeName,
  onNew,
  onPalette,
}: {
  scopeName: string | null;
  onNew: () => void;
  onPalette: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="ambient-glow relative flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <motion.div
        initial={reduce ? false : { scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <BrandOrb />
      </motion.div>
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-[9.5px] text-content-disabled uppercase tracking-[0.18em]">
          {scopeName ? `Scope · ${scopeName}` : 'Personal steward'}
        </span>
        <h2 className="font-semibold text-[22px] text-foreground leading-tight tracking-[-0.02em]">
          Pick up where you left off.
        </h2>
        <p className="max-w-sm text-[12.5px] text-content-secondary leading-relaxed">
          Choose a conversation on the left, or start something new. Tian keeps
          the context so you do not have to.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={onNew}>
          <ChatCircleDots size={13} />
          New conversation
        </Button>
        <Button variant="outline" size="sm" onClick={onPalette}>
          <MagnifyingGlass size={13} />
          Browse
          <Kbd className="ml-0.5 h-4 bg-secondary px-1 text-[9px]">⌘K</Kbd>
        </Button>
      </div>
    </div>
  );
}

function EmptyConversation({
  scopeName,
  onPick,
}: {
  scopeName: string | null;
  onPick: (prompt: string) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="ambient-glow relative mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-7 px-6 py-16 text-center">
      <motion.div
        initial={reduce ? false : { scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <span className={reduce ? 'inline-flex' : 'inline-flex animate-float'}>
          <BrandOrb />
        </span>
      </motion.div>
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-[9.5px] text-content-disabled uppercase tracking-[0.18em]">
          {scopeName ? `Scope · ${scopeName}` : 'Personal steward'}
        </span>
        <h2 className="font-semibold text-[22px] text-foreground leading-tight tracking-[-0.02em]">
          大内总管待命
        </h2>
        <p className="max-w-sm text-[12.5px] text-content-secondary leading-relaxed">
          Ask for a plan, a status check, or hand off a task. Tian remembers
          what matters across conversations.
        </p>
      </div>
      <div className="grid w-full max-w-lg gap-2 sm:grid-cols-3">
        {SUGGESTIONS.map((s, i) => {
          const SuggestionIcon = s.icon;
          return (
            <motion.button
              key={s.title}
              type="button"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 + i * 0.06, duration: 0.3, ease: EASE }}
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.985 }}
              onClick={() => onPick(s.prompt)}
              className="group flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-card/60 p-3 text-left transition-colors hover:border-border-secondary hover:bg-card"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-brand/10 text-brand">
                <SuggestionIcon size={12} weight="bold" />
              </span>
              <span className="text-[12px] text-foreground leading-tight">
                {s.title}
              </span>
              <span className="font-mono text-[9.5px] text-content-disabled">
                {s.hint}
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-content-disabled">
        <Sparkle size={10} weight="fill" className="text-brand/60" />
        press ⌘K for everything
      </div>
    </div>
  );
}

/** "working…" row that fades in while the steward is busy. */
function WorkingIndicator({
  working,
  reduce,
}: {
  working: boolean;
  reduce: boolean;
}) {
  return (
    <AnimatePresence>
      {working && (
        <motion.div
          key="working"
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5"
        >
          <BrandMark size="sm" />
          <TypingDots className="text-content-secondary" />
          <span className="shimmer-text font-mono text-[11px]">working…</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Floating "latest" affordance shown when the reader scrolled up. */
function JumpToLatest({
  show,
  reduce,
  onClick,
}: {
  show: boolean;
  reduce: boolean;
  onClick: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <div className="pointer-events-none absolute bottom-[7.5rem] left-1/2 z-10 -translate-x-1/2">
          <motion.button
            key="jump"
            type="button"
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.9 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={onClick}
            className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 font-mono text-[10px] text-content-secondary shadow-lg/5 backdrop-blur transition-colors hover:border-border-secondary hover:text-foreground"
          >
            <ArrowDown size={11} />
            latest
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  );
}

/** The message log plus the composer, mounted only for a real conversation. */
function Transcript({
  rows,
  busy,
  connected,
  scopeName,
  atBottom,
  reduce,
  viewportRef,
  composerRef,
  draft,
  onDraftChange,
  onSend,
  onPick,
  onScrollToLatest,
}: {
  rows: MessageRow[];
  busy: boolean;
  connected: boolean;
  scopeName: string | null;
  atBottom: boolean;
  reduce: boolean;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  onPick: (prompt: string) => void;
  onScrollToLatest: () => void;
}) {
  const working =
    busy && rows.every((r) => r.role !== 'assistant' || !r.streaming);
  const showJump = !atBottom && rows.length > 0;
  return (
    <>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewportRef}
        scrollbarGutter
        scrollFade
      >
        {rows.length === 0 ? (
          <EmptyConversation scopeName={scopeName} onPick={onPick} />
        ) : (
          <div
            role="log"
            aria-label="Messages"
            aria-live="polite"
            className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-7"
          >
            {rows.map((r) => (
              <MessageIn key={r.id} animate={!r.streaming}>
                <Row row={r} />
              </MessageIn>
            ))}
            <WorkingIndicator working={working} reduce={reduce} />
            <div className="h-px" />
          </div>
        )}
      </ScrollArea>

      <JumpToLatest
        show={showJump}
        reduce={reduce}
        onClick={onScrollToLatest}
      />

      <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-5 pt-2 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            disabled={!connected}
            busy={busy}
            value={draft}
            onValueChange={onDraftChange}
            onSend={onSend}
            onStop={() => void actions.abort()}
            textareaRef={composerRef}
          />
        </div>
      </div>
    </>
  );
}

export function ChatView() {
  const view = useStore((s) => s.view);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const activeScopeId = useStore((s) => s.activeScopeId);
  const connected = useStore((s) => s.runtimeStatus === 'ready');
  const scopes = useStore((s) => s.scopes);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const reduce = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [draft, setDraft] = useState('');

  const conv = conversations.find((c) => c.conversationId === activeId) ?? null;
  const scope = conv ? scopes.find((s) => s.id === conv.scopeId) : null;
  const activeScope = scopes.find((s) => s.id === activeScopeId) ?? null;
  // The service already reduced the transcript to renderable rows.
  const rows = view?.rows ?? [];
  const busy = view?.busy ?? false;

  // Reset the composer when switching conversations.
  useEffect(() => {
    setDraft('');
    stickRef.current = true;
    setAtBottom(true);
  }, [activeId]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const next = distance < 64;
      stickRef.current = next;
      setAtBottom(next);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeId]);

  // Keep the latest turn in view, but never fight a reader who scrolled up.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [view]);

  // Diagrams and images can grow after the first paint; stay pinned to the
  // bottom through those late layout changes.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const content = el.querySelector('[data-slot=scroll-area-content]');
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeId]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const el = viewportRef.current;
      if (!el) return;
      stickRef.current = true;
      setAtBottom(true);
      el.scrollTo({
        top: el.scrollHeight,
        behavior: reduce ? 'auto' : behavior,
      });
    },
    [reduce],
  );

  const send = (text: string) => {
    stickRef.current = true;
    void actions.send(text);
    requestAnimationFrame(() => scrollToLatest('smooth'));
  };

  const useSuggestion = (prompt: string) => {
    setDraft(prompt);
    composerRef.current?.focus();
  };

  return (
    <main
      aria-label="Conversation"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      {/* A folded sidebar leaves the traffic lights over this row's left. */}
      <header
        className={`flex h-11 shrink-0 items-center gap-2 border-border border-b bg-background/80 backdrop-blur-md [-webkit-app-region:drag] ${
          sidebarOpen ? 'px-4' : 'pr-4 pl-20'
        }`}
      >
        <SidebarToggle />
        {conv ? (
          <>
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary text-content-secondary"
            >
              <ChatCircleText size={12} />
            </span>
            <h1 className="min-w-0 truncate font-medium text-[13px]">
              {conv.title ?? 'New conversation'}
            </h1>
            {scope && (
              <Badge
                variant="outline"
                size="sm"
                className="shrink-0 gap-1 border-border/80 font-mono text-[9.5px] text-content-secondary"
              >
                <FolderSimple size={10} />
                {scope.name}
              </Badge>
            )}
          </>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
          <ContextToggle />
        </div>
      </header>

      {!conv ? (
        <WelcomePane
          scopeName={activeScope?.name ?? null}
          onNew={() => void actions.newConversation(activeScopeId)}
          onPalette={() => actions.setPaletteOpen(true)}
        />
      ) : (
        <Transcript
          rows={rows}
          busy={busy}
          connected={connected}
          scopeName={scope?.name ?? null}
          atBottom={atBottom}
          reduce={Boolean(reduce)}
          viewportRef={viewportRef}
          composerRef={composerRef}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          onPick={useSuggestion}
          onScrollToLatest={scrollToLatest}
        />
      )}
    </main>
  );
}
