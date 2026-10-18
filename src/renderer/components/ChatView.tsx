import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  CircleAlert,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { defaultComponents, Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChatComposer } from './ChatComposer';
// Pele adds ~400 KB; load it only when a diagram actually shows up.
const MermaidDiagram = lazy(() => import('./MermaidDiagram'));
import { MessageIn, Reveal } from './motion-primitives';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MessageRow, ToolCallRow } from '@/shared/messages';
import { actions, useStore } from '../store';
import { ModelPicker } from './ModelPicker';

/**
 * Prose styling for Streamdown output. Streamdown ships its own Tailwind
 * classes, so these selectors need to be specific enough to win without
 * fighting its component structure.
 */
const PROSE = [
  'text-[13.5px] leading-[1.7] text-foreground',
  '[&_p]:my-0 [&_p+p]:mt-3',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ul]:list-outside [&_ul_li]:pl-0 [&_ul_li]:py-0.5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:list-outside',
  '[&_li]:my-0 [&_li>p]:inline',
  '[&_a]:text-info-foreground [&_a]:underline [&_a]:underline-offset-2',
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

/** One tool call as a compact chip; expand for args and output. */
function ToolChip({ tool }: { tool: ToolCallRow }) {
  const [open, setOpen] = useState(false);
  const failed = tool.status === 'error';
  const running = tool.status === 'running';
  const expandable = Boolean(tool.args || tool.output);
  return (
    <div className="inline-flex max-w-full flex-col overflow-hidden rounded-md border border-border bg-secondary/60 align-top">
      <button
        type="button"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2 py-1 ${
          expandable ? 'cursor-pointer hover:bg-secondary' : 'cursor-default'
        }`}
      >
        {running ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-info" />
        ) : failed ? (
          <CircleAlert className="size-3 shrink-0 text-destructive-foreground" />
        ) : (
          <Check className="size-3 shrink-0 text-success-foreground" />
        )}
        <span className="truncate font-mono font-medium text-[11px] text-foreground">
          {tool.name}
        </span>
        {expandable && (
          <ChevronRight
            className={`size-3 shrink-0 text-content-disabled transition-transform duration-200 ${
              open ? 'rotate-90' : ''
            }`}
          />
        )}
      </button>
      <Reveal open={open}>
        <div className="border-border border-t">
          {tool.args && (
            <pre className="max-h-40 max-w-[42rem] overflow-auto bg-code px-2.5 py-1.5 whitespace-pre-wrap break-all font-mono text-[10.5px] text-content-secondary">
              {tool.args.slice(0, 2000)}
            </pre>
          )}
          {tool.output && (
            <pre
              className={`max-h-56 max-w-[42rem] overflow-auto bg-code px-2.5 py-1.5 whitespace-pre-wrap break-all font-mono text-[10.5px] ${
                failed
                  ? 'text-destructive-foreground'
                  : 'text-content-secondary'
              }`}
            >
              {tool.output.slice(0, 4000)}
            </pre>
          )}
        </div>
      </Reveal>
    </div>
  );
}

/** A round of tool calls, collapsed into a single summary line when long. */
function ToolGroup({ tools }: { tools: ToolCallRow[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.filter((t) => t.status === 'running').length;
  const failed = tools.filter((t) => t.status === 'error').length;
  if (tools.length <= 2) {
    return (
      <div className="flex flex-wrap items-start gap-1.5">
        {tools.map((t) => (
          <ToolChip key={t.callId} tool={t} />
        ))}
      </div>
    );
  }
  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 text-[11px] text-content-secondary hover:text-foreground"
      >
        <ChevronRight
          className={`size-3 shrink-0 text-content-disabled transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span className="font-medium">{tools.length} tool calls</span>
        {running > 0 && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-info-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-info" />
            {running} running
          </span>
        )}
        {failed > 0 && (
          <span className="font-mono text-[10px] text-destructive-foreground">
            {failed} failed
          </span>
        )}
      </button>
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
  return (
    <div
      role="article"
      aria-label="Assistant message"
      className="flex w-full max-w-[52rem] flex-col gap-2"
    >
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
        <div className="flex items-center gap-2 font-mono text-[11px] text-content-secondary">
          <span className="size-1.5 animate-pulse rounded-full bg-content-secondary" />
          thinking…
        </div>
      )}
    </div>
  );
}

function UserBubble({ row }: { row: MessageRow }) {
  return (
    <div
      role="article"
      aria-label="User message"
      className="flex w-full justify-end"
    >
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary px-3 py-2 text-[13px] text-secondary-foreground leading-relaxed">
        {row.text}
      </div>
    </div>
  );
}

function Row({ row }: { row: MessageRow }) {
  if (row.role === 'system') {
    return (
      <div
        role="separator"
        className="flex items-center gap-3 py-2 font-mono text-[10px] text-content-disabled uppercase tracking-[0.09em]"
      >
        <span className="h-px flex-1 bg-border" />
        {row.text}
        <span className="h-px flex-1 bg-border" />
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

function EmptyConversation({ scopeName }: { scopeName: string | null }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card">
        <Sparkles className="size-4 text-content-secondary" />
      </div>
      <h2 className="font-medium text-foreground text-sm">大内总管待命</h2>
      <p className="text-content-secondary text-xs leading-relaxed">
        {scopeName
          ? `Scope ${scopeName} 已就绪。说点什么，或者让它去派活。`
          : '说点什么，或者让它去派活。'}
      </p>
    </div>
  );
}

export function ChatView() {
  const view = useStore((s) => s.view);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const connected = useStore((s) => s.runtimeStatus === 'ready');
  const scopes = useStore((s) => s.scopes);
  const contextOpen = useStore((s) => s.contextOpen);
  const endRef = useRef<HTMLDivElement>(null);

  const conv = conversations.find((c) => c.conversationId === activeId) ?? null;
  const scope = conv ? scopes.find((s) => s.id === conv.scopeId) : null;
  // The service already reduced the transcript to renderable rows.
  const rows = view?.rows ?? [];
  const busy = view?.busy ?? false;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every view update
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [view]);

  return (
    <main
      aria-label="Conversation"
      className="relative flex min-w-0 flex-1 flex-col bg-background"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-border border-b px-4 [-webkit-app-region:drag]">
        {conv ? (
          <>
            <h1 className="min-w-0 truncate font-medium text-[13px]">
              {conv.title ?? 'New conversation'}
            </h1>
            {scope && (
              <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                {scope.name}
              </Badge>
            )}
          </>
        ) : (
          <span className="text-muted-foreground text-[13px]">Tian</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
          <ModelPicker />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={contextOpen ? 'Hide context pane' : 'Show context pane'}
            onClick={() => actions.setContextOpen(!contextOpen)}
          >
            {contextOpen ? (
              <PanelRightClose className="size-4" />
            ) : (
              <PanelRightOpen className="size-4" />
            )}
          </Button>
        </div>
      </header>

      {!conv ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground text-sm">
          {scope ? (
            <div className="flex flex-col items-center gap-3">
              <p>还没有选中会话。</p>
              <Button
                size="sm"
                onClick={() => void actions.newConversation(scope.id)}
              >
                开始新会话
              </Button>
            </div>
          ) : (
            'Select a conversation or start a new one'
          )}
        </div>
      ) : (
        <>
          <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
            {rows.length === 0 ? (
              <EmptyConversation scopeName={scope?.name ?? null} />
            ) : (
              <div
                role="log"
                aria-label="Messages"
                aria-live="polite"
                className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6"
              >
                {rows.map((r) => (
                  <MessageIn key={r.id} animate={!r.streaming}>
                    <Row row={r} />
                  </MessageIn>
                ))}
                {busy &&
                  rows.every((r) => r.role !== 'assistant' || !r.streaming) && (
                    <div
                      role="status"
                      className="flex items-center gap-2 text-muted-foreground text-xs"
                    >
                      <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/60" />
                      Working…
                    </div>
                  )}
                <div ref={endRef} className="h-px" />
              </div>
            )}
          </ScrollArea>

          <div className="shrink-0 px-5 pb-4">
            <div className="mx-auto w-full max-w-3xl">
              <ChatComposer
                disabled={!connected}
                busy={busy}
                onSend={(text) => void actions.send(text)}
                onStop={() => void actions.abort()}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
