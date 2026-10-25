import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  Bell,
  Brain,
  CalendarCheck,
  CaretRight,
  ChatCircleDots,
  ChatCircleText,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Copy,
  FileText,
  FolderSimple,
  GitMerge,
  Globe,
  MagnifyingGlass,
  Pulse,
  Sparkle,
  Target,
  Terminal,
  WarningCircle,
  Wrench,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { ChatComposer } from './ChatComposer';
import { Markdown } from './Markdown';
import { TypingDots, EASE } from './motion-primitives';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MessageRow, ToolCallRow } from '@/shared/messages';
import { noticeParts, sameRow } from '@/shared/messages';
import { actions, useStore } from '../store';
import { useT, type MessageKey } from '../i18n';
import { ContextToggle, SidebarToggle } from './SidebarToggle';
import { PaneHeader } from './PaneHeader';
import { BrandMark, BrandOrb } from './BrandMark';

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
      <CircleNotch
        size={11}
        aria-hidden="true"
        className="animate-spin text-info-foreground"
      />
    );
  if (status === 'error')
    return (
      <WarningCircle
        size={11}
        weight="fill"
        aria-hidden="true"
        className="text-destructive-foreground"
      />
    );
  if (status === 'pending')
    return (
      <Circle
        size={7}
        weight="fill"
        aria-hidden="true"
        className="text-content-disabled"
      />
    );
  return (
    <CheckCircle
      size={11}
      weight="fill"
      aria-hidden="true"
      className="text-content-secondary"
    />
  );
}

const TOOL_STATUS_LABEL = {
  pending: 'run.queued',
  running: 'run.running',
  done: 'run.done',
  error: 'run.failed',
} as const satisfies Record<ToolCallRow['status'], MessageKey>;

const TOOL_HINT_KEYS = [
  'title',
  'query',
  'project',
  'scope',
  'name',
  'path',
  'note',
  'task',
  'goal',
  'run',
  'id',
  'body',
  'text',
];

/** One short line of a tool's arguments, shown after its name. */
function toolHint(args: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const read = (value: unknown): string => {
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = read(item);
        if (text) return text;
      }
    }
    return '';
  };
  const record = parsed as Record<string, unknown>;
  for (const key of TOOL_HINT_KEYS) {
    const hint = read(record[key]);
    if (hint) return hint;
  }
  for (const value of Object.values(record)) {
    const hint = read(value);
    if (hint) return hint;
  }
  return '';
}

/** Expanded args/output body of a tool row. */
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

/**
 * One tool call as a quiet log row. The leading icon and name keep the same
 * place while args/output expand, so streaming text below is never dragged.
 */
function ToolRow({ tool }: { tool: ToolCallRow }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const failed = tool.status === 'error';
  const expandable = Boolean(tool.args || tool.output);
  const hint = toolHint(tool.args);
  const IconComponent = toolIcon(tool.name);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        disabled={!expandable}
        aria-label={`${tool.name}${hint ? ` ${hint.slice(0, 120)}` : ''}, ${t(TOOL_STATUS_LABEL[tool.status])}`}
        className={cn(
          'flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left',
          expandable
            ? 'cursor-pointer transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none'
            : 'cursor-default',
        )}
      >
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            failed ? 'text-destructive-foreground' : 'text-content-disabled',
          )}
        >
          <IconComponent size={11} weight="bold" aria-hidden="true" />
        </span>
        <span className="shrink-0 font-mono text-[11px] text-content-secondary">
          {tool.name}
        </span>
        {hint && (
          <span className="min-w-0 truncate text-[11px] text-content-disabled">
            {hint}
          </span>
        )}
        <span className="ms-auto flex shrink-0 items-center gap-1.5 ps-1.5">
          <ToolStatus status={tool.status} />
          <CaretRight
            size={9}
            aria-hidden="true"
            className={cn(
              'text-content-disabled transition-transform duration-150',
              open && 'rotate-90',
              !expandable && 'invisible',
            )}
          />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="ms-[22px] transition-none">
        {open && <ToolBody tool={tool} failed={failed} />}
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * A round's tool calls behind one dropdown. Collapsed rows keep the
 * transcript readable while a chief or manager makes many calls; expanding
 * never animates layout, so it cannot drift against the text stream.
 */
function ToolGroup({ tools }: { tools: ToolCallRow[] }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  if (tools.length === 0) return null;
  if (tools.length === 1) return <ToolRow tool={tools[0]} />;
  const running = tools.filter((tool) => tool.status === 'running').length;
  const failed = tools.filter((tool) => tool.status === 'error').length;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <CaretRight
          size={9}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-content-disabled transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <Wrench
          size={11}
          aria-hidden="true"
          className="shrink-0 text-content-disabled"
        />
        <span
          className={cn(
            'min-w-0 truncate font-medium text-[11.5px]',
            running > 0 ? 'shimmer-text' : 'text-content-secondary',
          )}
        >
          {t('chat.toolCalls', { count: tools.length })}
        </span>
        {running > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-info-foreground">
            <CircleNotch size={9} aria-hidden="true" className="animate-spin" />
            {t('chat.running', { count: running })}
          </span>
        )}
        {failed > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-destructive-foreground">
            <WarningCircle size={9} weight="fill" aria-hidden="true" />
            {t('chat.failed', { count: failed })}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsiblePanel className="transition-none">
        {open && (
          <div
            role="region"
            aria-label={t('chat.toolCalls', { count: tools.length })}
            // A capped scroller must accept focus so keyboard users can reach
            // the rows scrolled out of view.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="mt-0.5 ms-[10px] flex max-h-[min(18rem,50dvh)] flex-col overflow-y-auto overscroll-contain rounded-md border-s border-border/70 pe-1 ps-1 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            {tools.map((tool) => (
              <ToolRow key={tool.callId} tool={tool} />
            ))}
          </div>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function AssistantBubble({ row }: { row: MessageRow }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
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
      aria-label={t('chat.assistantMessage')}
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
            {t('chat.writing')}
          </span>
        )}
        {row.text && !row.streaming && (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={t(copied ? 'chat.copied' : 'chat.copy')}
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
      {row.text && (
        <Markdown text={row.text} animated streaming={Boolean(row.streaming)} />
      )}
      {row.toolCalls && row.toolCalls.length > 0 && (
        <ToolGroup tools={row.toolCalls} />
      )}
      {row.streaming && !row.text && (
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-content-secondary">
          <TypingDots className="text-content-secondary" />
          <span className="shimmer-text">{t('chat.thinking')}</span>
        </div>
      )}
    </article>
  );
}

function UserBubble({ row }: { row: MessageRow }) {
  const t = useT();
  return (
    <article
      aria-label={t('chat.userMessage')}
      className="flex w-full justify-end"
    >
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-xl rounded-br-md border border-border border-b-border-secondary/70 bg-secondary px-3.5 py-2 text-[13px] text-secondary-foreground leading-relaxed shadow-[0_1px_0_hsl(0_0%_100%/0.04)_inset]">
        {row.text}
      </div>
    </article>
  );
}

/**
 * A system wake shown as prose: manager/worker reports, run wakens, channel
 * imports. These are written in markdown by an agent, so render them as such
 * instead of dumping the raw source between two rules. The bracketed first
 * line (`[run … finished]`, `[<project> manager reports]`) becomes the label.
 */
function NoticeCard({ row }: { row: MessageRow }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied; leave the message untouched.
    }
  };
  const head = noticeParts(row.text);
  return (
    <article
      aria-label={t('chat.notification')}
      className="group/notice rounded-xl border border-border bg-card/60 px-3.5 py-2.5"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Bell
          size={10}
          weight="fill"
          className="shrink-0 text-content-disabled"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate font-mono text-[9.5px] text-content-disabled tracking-[0.1em]">
          {head.label ?? t('chat.notification')}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={t(copied ? 'chat.copied' : 'chat.copy')}
          className="ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-content-disabled opacity-0 transition-[opacity,background-color,color] hover:bg-secondary hover:text-foreground group-hover/notice:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <Check size={11} weight="bold" className="text-content-secondary" />
          ) : (
            <Copy size={11} />
          )}
        </button>
      </div>
      <Markdown
        text={head.body || row.text}
        className="text-[12.5px] text-content-secondary"
      />
    </article>
  );
}

// Snapshots rebuild every row object; memo by content so steady rows skip
// re-rendering while a streamed turn updates.
const Row = memo(
  function Row({ row }: { row: MessageRow }) {
    if (row.role === 'system') {
      return row.variant === 'notice' ? (
        <NoticeCard row={row} />
      ) : (
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
  },
  (prev, next) => sameRow(prev.row, next.row),
);

const SUGGESTIONS: {
  icon: Icon;
  title: MessageKey;
  hint: MessageKey;
  prompt: MessageKey;
}[] = [
  {
    icon: CalendarCheck,
    title: 'chat.suggestion.plan.title',
    hint: 'chat.suggestion.plan.hint',
    prompt: 'chat.suggestion.plan.prompt',
  },
  {
    icon: Target,
    title: 'chat.suggestion.goals.title',
    hint: 'chat.suggestion.goals.hint',
    prompt: 'chat.suggestion.goals.prompt',
  },
  {
    icon: Pulse,
    title: 'chat.suggestion.check.title',
    hint: 'chat.suggestion.check.hint',
    prompt: 'chat.suggestion.check.prompt',
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
  const t = useT();
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
          {scopeName
            ? t('chat.scopeTag', { name: scopeName })
            : t('chat.personalSteward')}
        </span>
        <h2 className="font-semibold text-[22px] text-foreground leading-tight tracking-[-0.02em]">
          {t('chat.welcomeTitle')}
        </h2>
        <p className="max-w-sm text-[12.5px] text-content-secondary leading-relaxed">
          {t('chat.welcomeBody')}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={onNew}>
          <ChatCircleDots size={13} />
          {t('common.newConversation')}
        </Button>
        <Button variant="outline" size="sm" onClick={onPalette}>
          <MagnifyingGlass size={13} />
          {t('chat.browse')}
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
  const t = useT();
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
          {scopeName
            ? t('chat.scopeTag', { name: scopeName })
            : t('chat.personalSteward')}
        </span>
        <h2 className="font-semibold text-[22px] text-foreground leading-tight tracking-[-0.02em]">
          {t('chat.emptyTitle')}
        </h2>
        <p className="max-w-sm text-[12.5px] text-content-secondary leading-relaxed">
          {t('chat.emptyBody')}
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
              onClick={() => onPick(t(s.prompt))}
              className="group flex cursor-pointer flex-col items-start gap-2 rounded-xl border border-border bg-card/60 p-3 text-left transition-colors hover:border-border-secondary hover:bg-card"
            >
              <span className="flex size-6 items-center justify-center rounded-md bg-brand/10 text-brand">
                <SuggestionIcon size={12} weight="bold" />
              </span>
              <span className="text-[12px] text-foreground leading-tight">
                {t(s.title)}
              </span>
              <span className="font-mono text-[9.5px] text-content-disabled">
                {t(s.hint)}
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-content-disabled">
        <Sparkle size={10} weight="fill" className="text-brand/60" />
        {t('chat.pressK')}
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
  const t = useT();
  return (
    <AnimatePresence>
      {working && (
        <motion.div
          key="working"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5"
        >
          <BrandMark size="sm" />
          <TypingDots className="text-content-secondary" />
          <span className="shimmer-text font-mono text-[11px]">
            {t('chat.working')}
          </span>
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
  const t = useT();
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
            {t('chat.latest')}
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
  scopeId,
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
  scopeId: string | null;
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
  const t = useT();
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
            aria-label={t('chat.messages')}
            aria-live="polite"
            aria-busy={busy}
            className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-7"
          >
            {rows.map((r) => (
              <Row key={r.id} row={r} />
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
            scopeName={scopeName}
            scopeId={scopeId}
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
  const contextOpen = useStore((s) => s.contextOpen);
  const reduce = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [draft, setDraft] = useState('');
  const t = useT();

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
      aria-label={t('chat.conversation')}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      {/* A folded sidebar leaves the traffic lights over this row's left. */}
      <PaneHeader clearance={!sidebarOpen}>
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
              {conv.title ?? t('common.newConversation')}
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
          {/* The open context pane carries its own toggle at the same seam;
              showing both would put two identical buttons side by side. */}
          {!contextOpen && <ContextToggle />}
        </div>
      </PaneHeader>

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
          scopeId={scope?.id ?? null}
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
