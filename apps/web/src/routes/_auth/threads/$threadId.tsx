import { code } from '@streamdown/code';
import { useLiveQuery } from '@tanstack/react-db';
import { Navigate, createFileRoute } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Streamdown } from 'streamdown';

import type { Message, Part } from '@canary/sync';

import { AgentPrompt } from '~/components/agent-prompt';
import { AgentIcon, LatestIcon } from '~/components/icons';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { active, messages, pieces, roster, transcript } from '~/utils/chat';
import { client } from '~/utils/orpc';

const TRANSCRIPT_BOTTOM_BREATHING_ROOM = 112;
const TRANSCRIPT_END_THRESHOLD = 96;

type TranscriptRow =
  | {
      id: string;
      kind: 'assistant';
      live: boolean;
      msg?: Message;
      parts: Part[];
      text: string;
    }
  | { id: string; kind: 'user'; msg: Message };

type TranscriptBlock = {
  at: string;
  id: string;
  rank: number;
  row: TranscriptRow | null;
};

export const Route = createFileRoute('/_auth/threads/$threadId')({
  ssr: false,
  loader: async ({ context, params }) => {
    await Promise.all([
      roster(context.user.id).preload(),
      transcript(context.user.id, params.threadId).preload(),
      pieces(context.user.id, params.threadId).preload(),
      active(context.user.id, params.threadId).preload(),
    ]);

    return null;
  },
  component: ThreadComponent,
});

function ThreadComponent() {
  const ctx = Route.useRouteContext();
  const params = Route.useParams();

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const ownerId = ctx.user.id;

  const rosterQuery = useLiveQuery(roster(ownerId));
  const activeRunsQuery = useLiveQuery(active(ownerId, params.threadId));
  const transcriptQuery = useLiveQuery(transcript(ownerId, params.threadId));

  const thread = rosterQuery.data.find((row) => row.id === params.threadId);
  const threadGone = rosterQuery.isReady && !thread;
  const running = activeRunsQuery.data.length > 0;

  const pristine = !transcriptQuery.data.some(
    (msg) => msg.threadId === params.threadId && msg.role === 'user',
  );

  const submitUserMessage = useCallback(
    async (body: string) => {
      const content = body.trim();

      if (!thread || !content) {
        return;
      }

      const now = new Date().toISOString();

      const transaction = messages(ownerId).insert({
        id: crypto.randomUUID(),
        threadId: params.threadId,
        ownerId,
        runId: null,
        role: 'user',
        content,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });

      setDraft('');
      setSendError(null);

      await transaction.isPersisted.promise.catch((cause: unknown) => {
        setDraft((current) => current || content);
        setSendError(cause instanceof Error ? cause.message : 'Message send failed.');
        throw cause;
      });
    },
    [ownerId, params.threadId, thread],
  );

  const cancelActiveRun = useCallback(async () => {
    const run = activeRunsQuery.data[0];

    if (!run) {
      return;
    }

    await client.run.cancel({ id: run.id });
  }, [activeRunsQuery.data]);

  if (threadGone) {
    return <Navigate to="/threads" replace />;
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] bg-background">
      <header className="border-b border-line px-4 py-3">
        <h1 className="truncate text-sm font-semibold">{thread?.title ?? 'Thread'}</h1>
        <p className="truncate text-[11px] text-muted-foreground">{params.threadId}</p>
      </header>

      <div className="relative h-full min-h-0">
        <TranscriptShell key={params.threadId} ownerId={ownerId} threadId={params.threadId} />
        <AgentActivity running={running} />
      </div>

      <AgentPrompt
        disabled={!thread}
        error={sendError}
        pristine={pristine}
        running={running}
        value={draft}
        onCancel={() => {
          cancelActiveRun().catch((cause: unknown) => {
            console.error('Run cancellation failed.', cause);
          });
        }}
        onSubmit={(body) => {
          submitUserMessage(body).catch((cause: unknown) => {
            console.error('Message send failed.', cause);
          });
        }}
        onValue={setDraft}
      />
    </div>
  );
}

const TranscriptShell = memo(function TranscriptShell(props: {
  ownerId: string;
  threadId: string;
}) {
  const transcriptQuery = useLiveQuery(transcript(props.ownerId, props.threadId));
  const partsQuery = useLiveQuery(pieces(props.ownerId, props.threadId));

  const rawMessages = transcriptQuery.data;
  const rawParts = partsQuery.data;

  const hasForeignMessages = rawMessages.some((msg) => msg.threadId !== props.threadId);

  const hasExplicitForeignParts = rawParts.some((part) => {
    const threadId = explicitPartThreadId(part);
    return typeof threadId === 'string' && threadId !== props.threadId;
  });

  const scopedMessages = useMemo(
    () => rawMessages.filter((msg) => msg.threadId === props.threadId),
    [rawMessages, props.threadId],
  );

  const scopedMessageIds = useMemo(
    () => new Set(scopedMessages.map((msg) => msg.id)),
    [scopedMessages],
  );

  const scopedRunIds = useMemo(
    () => new Set(scopedMessages.flatMap((msg) => (msg.runId ? [msg.runId] : []))),
    [scopedMessages],
  );

  const scopedParts = useMemo(
    () =>
      rawParts.filter((part) =>
        isPartForCurrentThread(part, props.threadId, scopedMessageIds, scopedRunIds),
      ),
    [rawParts, props.threadId, scopedMessageIds, scopedRunIds],
  );

  const ready =
    transcriptQuery.isReady &&
    partsQuery.isReady &&
    !hasForeignMessages &&
    !hasExplicitForeignParts;

  const rows = useMemo(() => {
    if (!ready) {
      return [];
    }

    return materializeTranscript(scopedMessages, scopedParts);
  }, [ready, scopedMessages, scopedParts]);

  if (!ready) {
    return (
      <StaticTranscriptViewport>
        <TranscriptLoading />
      </StaticTranscriptViewport>
    );
  }

  if (!rows.length) {
    return (
      <StaticTranscriptViewport>
        <TranscriptEmpty />
      </StaticTranscriptViewport>
    );
  }

  return <VirtualThread rows={rows} threadId={props.threadId} />;
});

function StaticTranscriptViewport(props: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-3 pt-6 [overflow-anchor:none] scrollbar-gutter-both">
      <div className="mx-auto max-w-3xl">{props.children}</div>
    </div>
  );
}

function TranscriptLoading() {
  return <div className="min-h-20" />;
}

function TranscriptEmpty() {
  return (
    <p className="grid min-h-64 place-items-center text-sm text-muted-foreground">
      Send the first message.
    </p>
  );
}

function VirtualThread(props: {
  rows: TranscriptRow[];
  threadId: string;
}) {
  return <VirtualThreadInstance key={props.threadId} {...props} />;
}

const VirtualThreadInstance = memo(function VirtualThreadInstance(props: {
  rows: TranscriptRow[];
  threadId: string;
}) {
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const jumpingRef = useRef(false);

  const [didInitialScroll, setDidInitialScroll] = useState(false);
  const [isPinnedToLatest, setIsPinnedToLatestState] = useState(true);
  const [isJumpingToLatest, setIsJumpingToLatestState] = useState(false);

  const setPinnedToLatest = useCallback((next: boolean) => {
    pinnedRef.current = next;
    setIsPinnedToLatestState((current) => (current === next ? current : next));
  }, []);

  const setJumpingToLatest = useCallback((next: boolean) => {
    jumpingRef.current = next;
    setIsJumpingToLatestState((current) => (current === next ? current : next));
  }, []);

  const getVirtualRowKey = useCallback(
    (index: number) => {
      const row = props.rows[index];

      return row ? `${props.threadId}:${row.id}` : `${props.threadId}:missing:${index}`;
    },
    [props.rows, props.threadId],
  );

  const estimateVirtualRowSize = useCallback(
    (index: number) =>
      estimateRowHeight(props.rows[index]) + rowSpacing(props.rows[index], props.rows[index - 1]),
    [props.rows],
  );

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: props.rows.length,
    getScrollElement: () => scrollElementRef.current,
    getItemKey: getVirtualRowKey,
    estimateSize: estimateVirtualRowSize,

    overscan: 10,
    gap: 0,

    paddingEnd: TRANSCRIPT_BOTTOM_BREATHING_ROOM,
    scrollPaddingEnd: TRANSCRIPT_BOTTOM_BREATHING_ROOM,

    anchorTo: 'end',
    followOnAppend: 'auto',
    scrollEndThreshold: TRANSCRIPT_END_THRESHOLD,

    directDomUpdates: true,

    onChange: (instance) => {
      const atLatest = instance.isAtEnd();

      if (jumpingRef.current && atLatest) {
        setJumpingToLatest(false);
      }

      if (pinnedRef.current !== atLatest) {
        setPinnedToLatest(atLatest);
      }
    },
  });

  useLayoutEffect(() => {
    if (didInitialScroll || props.rows.length === 0 || !scrollElementRef.current) {
      return;
    }

    setPinnedToLatest(true);
    setJumpingToLatest(false);

    virtualizer.scrollToEnd({ behavior: 'instant' });

    setDidInitialScroll(true);
  }, [
    didInitialScroll,
    props.rows.length,
    setJumpingToLatest,
    setPinnedToLatest,
    virtualizer,
  ]);

  const jumpToLatest = useCallback(() => {
    setPinnedToLatest(true);
    setJumpingToLatest(true);

    virtualizer.scrollToEnd({ behavior: 'smooth' });
  }, [setJumpingToLatest, setPinnedToLatest, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();

  const showJumpToLatest = didInitialScroll && !isPinnedToLatest && !isJumpingToLatest;

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollElementRef}
        className="h-full min-h-0 overflow-y-auto px-3 pt-6 [overflow-anchor:none] scrollbar-gutter-both"
        style={{
          visibility: didInitialScroll ? undefined : 'hidden',
          pointerEvents: didInitialScroll ? undefined : 'none',
        }}
        tabIndex={-1}
      >
        <div className="mx-auto max-w-3xl">
          <div ref={virtualizer.containerRef} className="relative w-full">
            {virtualRows.map((virtualRow) => {
              const row = props.rows[virtualRow.index];

              if (!row) {
                return null;
              }

              const previousRow = props.rows[virtualRow.index - 1];

              return (
                <div
                  key={String(virtualRow.key)}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 flow-root w-full min-w-0"
                  data-index={virtualRow.index}
                  style={{
                    paddingTop: `${rowSpacing(row, previousRow)}px`,
                  }}
                >
                  <TranscriptRowView row={row} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <JumpToLatestHud show={showJumpToLatest} onJump={jumpToLatest} />
    </div>
  );
});

function TranscriptRowView(props: { row: TranscriptRow }) {
  if (props.row.kind === 'user') {
    return <UserMessage msg={props.row.msg} />;
  }

  return <AssistantTurn row={props.row} />;
}

function UserMessage(props: { msg: Message }) {
  return (
    <Card
      className="ml-auto w-fit max-w-[min(80%,44rem)] rounded-xl border-line bg-row py-2 "
      size="sm"
    >
      <CardContent className="px-3.5">
        <Markdown
          className="text-sm leading-7 wrap-anywhere *:first:mt-0 *:last:mb-0"
          text={props.msg.content}
        />
      </CardContent>
    </Card>
  );
}

function AssistantTurn(props: { row: Extract<TranscriptRow, { kind: 'assistant' }> }) {
  if (!props.row.parts.length) {
    return (
      <div className="flow-root min-w-0 max-w-full">
        <Markdown live={props.row.live} text={props.row.text} />
      </div>
    );
  }

  return (
    <div className="flow-root min-w-0 max-w-full space-y-3">
      {props.row.parts.map((part) => (
        <AssistantPart key={part.id} live={part.status === 'running'} part={part} />
      ))}
    </div>
  );
}

function AssistantPart(props: { live: boolean; part: Part }) {
  if (props.part.kind === 'text') {
    return <Markdown live={props.live} text={partContent(props.part)} />;
  }

  if (props.part.kind === 'reasoning') {
    return <ReasoningPart live={props.live} part={props.part} />;
  }

  return <StructuredPart part={props.part} />;
}

function Disclosure(props: {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const effectiveOpen = props.forceOpen || open;

  return (
    <details
      className={props.className}
      open={effectiveOpen}
      onToggle={(event) => {
        if (props.forceOpen) {
          return;
        }

        setOpen(event.currentTarget.open);
      }}
    >
      {props.children}
    </details>
  );
}

function ReasoningPart(props: { live?: boolean; part: Part }) {
  const running = props.part.status === 'running';

  return (
    <Disclosure
      className="flow-root min-w-0 max-w-full rounded-xl border border-line bg-surface/80 p-3 text-xs"
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
      <Markdown live={props.live} text={partContent(props.part)} />
    </Disclosure>
  );
}

function StructuredPart(props: { part: Part }) {
  const body = structuredPartBody(props.part);
  const running = props.part.status === 'running';

  return (
    <Disclosure
      className="my-2 flow-root min-w-0 max-w-full rounded-xl border border-line bg-surface/85 text-xs "
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0 truncate font-mono text-xs font-semibold">
          {structuredPartTitle(props.part)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{props.part.status}</span>
      </summary>

      {body ? (
        <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap border-t border-line bg-surface-raised px-4 py-3 leading-5 wrap-anywhere">
          {body}
        </pre>
      ) : null}
    </Disclosure>
  );
}

function JumpToLatestHud(props: { onJump: () => void; show: boolean }) {
  if (!props.show) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-3">
      <div className="mx-auto flex max-w-4xl justify-center">
        <Button
          aria-label="Jump to latest"
          className="pointer-events-auto rounded-sm bg-muted!"
          size="icon"
          title="Jump to latest"
          type="button"
          variant="outline"
          onClick={props.onJump}
        >
          <LatestIcon />
        </Button>
      </div>
    </div>
  );
}

function AgentActivity(props: { running: boolean }) {
  if (!props.running) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10">
      <div className="rounded-full border border-line bg-background/90 px-3 py-2 backdrop-blur">
        <WorkIndicator />
      </div>
    </div>
  );
}

const Markdown = memo(function Markdown(props: {
  className?: string;
  live?: boolean;
  text: string;
}) {
  return (
    <Streamdown
      className={props.className ? `canary-markdown ${props.className}` : 'canary-markdown'}
      mode={props.live ? 'streaming' : 'static'}
      plugins={{ code }}
    >
      {props.text}
    </Streamdown>
  );
});

function materializeTranscript(msgs: Message[], parts: Part[]): TranscriptRow[] {
  const partsByMessageId = groupPartsByMessageId(parts);
  const finishedRunIds = new Set(msgs.flatMap((msg) => (msg.runId ? [msg.runId] : [])));

  const blocks: TranscriptBlock[] = [];

  for (const msg of orderMessages(msgs)) {
    const msgParts = orderParts(partsByMessageId.get(msg.id) ?? []);
    const row = messageRow(msg, msgParts);

    blocks.push({
      id: `block:${transcriptMessageRowId(msg)}`,
      at: msgParts[0]?.createdAt ?? msg.createdAt,
      rank: msg.role === 'user' ? 0 : 1,
      row,
    });
  }

  for (const [runId, runParts] of groupLiveRunParts(parts, finishedRunIds)) {
    const orderedParts = orderParts(runParts);

    blocks.push({
      id: `block:run:${runId}`,
      at: orderedParts[0]?.createdAt ?? '',
      rank: 1,
      row: {
        id: `run:${runId}`,
        kind: 'assistant',
        live: true,
        parts: orderedParts,
        text: '',
      },
    });
  }

  return blocks
    .filter((block): block is TranscriptBlock & { row: TranscriptRow } => block.row !== null)
    .toSorted((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank || a.id.localeCompare(b.id))
    .map((block) => block.row);
}

function messageRow(msg: Message, parts: Part[]): TranscriptRow | null {
  if (msg.role === 'user') {
    return {
      id: transcriptMessageRowId(msg),
      kind: 'user',
      msg,
    };
  }

  const visibleParts = parts.filter(isVisiblePart);

  if (visibleParts.length) {
    return {
      id: transcriptMessageRowId(msg),
      kind: 'assistant',
      live: visibleParts.some((part) => part.status === 'running'),
      msg,
      parts: visibleParts,
      text: msg.content,
    };
  }

  if (!msg.content.trim()) {
    return null;
  }

  return {
    id: transcriptMessageRowId(msg),
    kind: 'assistant',
    live: false,
    msg,
    parts: [],
    text: msg.content,
  };
}

function transcriptMessageRowId(msg: Message) {
  if (msg.role === 'assistant' && msg.runId) {
    return `run:${msg.runId}`;
  }

  return `msg:${msg.id}`;
}

function groupPartsByMessageId(parts: Part[]) {
  const grouped = new Map<string, Part[]>();

  for (const part of parts) {
    if (!part.messageId) {
      continue;
    }

    const group = grouped.get(part.messageId);

    if (group) {
      group.push(part);
    } else {
      grouped.set(part.messageId, [part]);
    }
  }

  return grouped;
}

function groupLiveRunParts(parts: Part[], finishedRunIds: Set<string>) {
  const grouped = new Map<string, Part[]>();

  for (const part of parts) {
    if (part.messageId || !part.runId || finishedRunIds.has(part.runId) || !isVisiblePart(part)) {
      continue;
    }

    const group = grouped.get(part.runId);

    if (group) {
      group.push(part);
    } else {
      grouped.set(part.runId, [part]);
    }
  }

  return grouped;
}

function orderMessages(messages: Message[]) {
  return messages.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function orderParts(parts: Part[]) {
  return parts.toSorted(
    (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function isVisiblePart(part: Part) {
  if (part.kind === 'text' || part.kind === 'reasoning') {
    return part.status === 'running' || !!partContent(part).trim();
  }

  return true;
}

function isToolPart(part: Part) {
  return part.kind === 'tool-call' || part.kind === 'tool-result';
}

function explicitPartThreadId(part: Part) {
  const maybeThreadId = 'threadId' in part ? (part as { threadId?: unknown }).threadId : undefined;

  return typeof maybeThreadId === 'string' ? maybeThreadId : null;
}

function isPartForCurrentThread(
  part: Part,
  threadId: string,
  messageIds: Set<string>,
  runIds: Set<string>,
) {
  const maybeThreadId = explicitPartThreadId(part);

  if (maybeThreadId) {
    return maybeThreadId === threadId;
  }

  if (part.messageId && messageIds.has(part.messageId)) {
    return true;
  }

  if (part.runId && runIds.has(part.runId)) {
    return true;
  }

  return false;
}

function estimateRowHeight(row: TranscriptRow | undefined) {
  if (!row) {
    return 180;
  }

  if (row.kind === 'user') {
    return Math.max(96, Math.min(340, 72 + row.msg.content.length * 0.32));
  }

  const textLength = row.parts.length
    ? row.parts.reduce((total, part) => total + estimatePartTextLength(part), 0)
    : row.text.length;

  const structuralCost = row.parts.reduce((total, part) => {
    if (isToolPart(part)) {
      return total + 160;
    }

    if (part.kind === 'artifact') {
      return total + 220;
    }

    if (part.kind === 'error') {
      return total + 140;
    }

    if (part.kind === 'status') {
      return total + 72;
    }

    if (part.kind === 'reasoning') {
      return total + 120;
    }

    return total;
  }, 0);

  return Math.max(140, Math.min(1100, 96 + textLength * 0.42 + structuralCost));
}

function estimatePartTextLength(part: Part) {
  const content = partContent(part).trim();

  if (content) {
    return content.length;
  }

  if (isToolPart(part) && partData(part)) {
    return 420;
  }

  if (part.kind === 'artifact' && partData(part)) {
    return 560;
  }

  if (part.kind === 'error') {
    return 220;
  }

  return 0;
}

function rowSpacing(row: TranscriptRow | undefined, previousRow: TranscriptRow | undefined) {
  if (!row || !previousRow) {
    return 0;
  }

  if (row.kind === 'user' && previousRow.kind === 'user') {
    return 12;
  }

  if (row.kind === 'user' || previousRow.kind === 'user') {
    return 32;
  }

  return 16;
}

function structuredPartTitle(part: Part) {
  if ('toolName' in part && typeof part.toolName === 'string' && part.toolName.trim()) {
    return part.toolName;
  }

  if (part.kind === 'tool-call') {
    return 'tool call';
  }

  if (part.kind === 'tool-result') {
    return 'tool result';
  }

  return part.kind;
}

function structuredPartBody(part: Part) {
  const content = partContent(part).trim();

  if (content) {
    return content;
  }

  const data = partData(part);

  if (data === undefined || data === null) {
    return '';
  }

  try {
    return JSON.stringify(data, null, 2) ?? '';
  } catch {
    return String(data);
  }
}

function partContent(part: Part) {
  return 'content' in part && typeof part.content === 'string' ? part.content : '';
}

function partData(part: Part) {
  return 'data' in part ? part.data : undefined;
}

function WorkIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <AgentIcon className="size-4 animate-pulse text-muted-foreground" />
      Agent is working...
    </div>
  );
}