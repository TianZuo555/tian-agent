import { useEffect, useRef } from 'react';
import { ArrowUp, Square, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Composer,
  ComposerActionGroup,
  ComposerActions,
  ComposerInput,
  ComposerSubmit,
  getComposerText,
} from '@/components/ui/composer';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MessageRow, ToolCallRow } from '../messages';
import { toRows } from '../messages';
import { actions, useStore } from '../store';

function ToolRow({ tool }: { tool: ToolCallRow }) {
  return (
    <details
      className="group rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-xs"
      aria-label={`Tool call: ${tool.name}`}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground"
        aria-label={`${tool.name} — ${tool.status}`}
      >
        <Wrench className="size-3 shrink-0" />
        <span className="font-mono">{tool.name}</span>
        <Badge
          variant={tool.status === 'error' ? 'destructive' : 'outline'}
          className="ml-auto font-normal text-[10px]"
        >
          {tool.status}
        </Badge>
      </summary>
      {tool.output && (
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground/80">
          {tool.output.slice(0, 2000)}
        </pre>
      )}
    </details>
  );
}

function Row({ row }: { row: MessageRow }) {
  if (row.role === 'system') {
    return (
      <div
        role="separator"
        className="py-1 text-center text-muted-foreground/60 text-xs"
      >
        {row.text}
      </div>
    );
  }
  const isUser = row.role === 'user';
  return (
    <div
      role="article"
      aria-label={isUser ? 'User message' : 'Assistant message'}
      className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {(row.toolCalls ?? []).map((t) => (
        <ToolRow key={t.callId} tool={t} />
      ))}
      {row.text && (
        <div
          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/60 text-foreground'
          }`}
        >
          <span className="whitespace-pre-wrap break-words">{row.text}</span>
        </div>
      )}
    </div>
  );
}

export function ChatView() {
  const view = useStore((s) => s.view);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const settings = useStore((s) => s.settings);
  const scopes = useStore((s) => s.scopes);
  const endRef = useRef<HTMLDivElement>(null);

  const conv = conversations.find((c) => c.conversationId === activeId) ?? null;
  const scope = conv ? scopes.find((s) => s.id === conv.scopeId) : null;
  const { rows, busy } = toRows(view ?? undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every view update
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [view]);

  if (!conv) {
    return (
      <main
        aria-label="Conversation"
        className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground text-sm"
      >
        Select a conversation or start a new one
      </main>
    );
  }

  return (
    <main aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-border border-b px-4 py-2.5">
        <h1 className="truncate font-medium text-sm">
          {conv.title ?? 'Untitled'}
        </h1>
        {scope && (
          <Badge
            variant="secondary"
            className="shrink-0 font-normal text-[10px]"
          >
            {scope.name}
          </Badge>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">
          {settings
            ? `${settings.model.provider} · ${settings.model.modelId}`
            : ''}
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          role="log"
          aria-label="Messages"
          aria-live="polite"
          className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-4"
        >
          {rows.map((r) => (
            <Row key={r.id} row={r} />
          ))}
          {busy && (
            <div
              role="status"
              className="flex items-center gap-2 text-muted-foreground text-xs"
            >
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
              Working…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="border-border border-t px-4 py-3">
        <Composer
          className="mx-auto max-w-3xl"
          submitOnEnter="always"
          onSubmit={(v) => {
            const text = getComposerText(v).trim();
            if (text) void actions.send(text);
          }}
        >
          <ComposerInput
            aria-label="Message composer"
            placeholder="Message the steward… (Enter to send)"
          />
          <ComposerActions>
            <ComposerActionGroup align="end">
              {busy ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Stop"
                  onClick={() => void actions.abort()}
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <ComposerSubmit
                  render={<Button size="icon-sm" aria-label="Send" />}
                >
                  <ArrowUp className="size-4" />
                </ComposerSubmit>
              )}
            </ComposerActionGroup>
          </ComposerActions>
        </Composer>
      </div>
    </main>
  );
}
