import { createBrowserInspector } from '@statelyai/inspect';
import { code } from '@streamdown/code';
import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useActorRef, useSelector } from '@xstate/react';
import {
  forwardRef,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Streamdown } from 'streamdown';
import { VList, type VListHandle } from 'virtua';
import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import type { Part, Message as SyncMessage } from '@canary/sync';

import { AgentPrompt } from '~/components/agent-prompt';
import { LatestIcon } from '~/components/icons';
import { shellRoutes } from '~/components/shell/model';
import { Bubble, BubbleContent } from '~/components/ui/bubble';
import { Message, MessageContent } from '~/components/ui/message';
import { cn } from '~/lib/utils';
import { active, messages, pieces, roster, transcript } from '~/utils/chat';
import { client } from '~/utils/orpc';

const TRANSCRIPT_BUFFER_SIZE = 768;
const TRANSCRIPT_EDGE_THRESHOLD = 96;
const TRANSCRIPT_PREVIOUS_TURN_PEEK = 64;
const TRANSCRIPT_END_BREATHING_ROOM = 152;
const TRANSCRIPT_MIN_ANCHOR_SPACER = 112;
const TRANSCRIPT_TAIL_RETIRE_MARGIN = 96;
const TRANSCRIPT_SCROLL_SETTLE_DELAY = 180;
const TRANSCRIPT_TAIL_SPACER_KEY = '__transcript-tail-spacer__';

const USER_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

const transcriptScrollInspector =
  import.meta.env.DEV && typeof window !== 'undefined' ? createBrowserInspector() : null;

const transcriptScrollInspect = transcriptScrollInspector?.inspect;

type CssVars = CSSProperties & Record<`--${string}`, string | number | undefined>;

type ReadonlyRef<T> = {
  readonly current: T;
};

type TranscriptScrollMode =
  | 'anchored-turn'
  | 'escaping-follow-bottom'
  | 'following-bottom'
  | 'free'
  | 'landing-to-latest'
  | 'pre-anchoring-next-turn';

type TranscriptTailRetirement = 'idle' | 'pending';

type TranscriptScrollContext = {
  atLatest: boolean;
  hasLeftLatest: boolean;
  latestTurnId: string | null;
  layoutBusy: boolean;
  tailRetirement: TranscriptTailRetirement;
};

type TranscriptScrollMachineEvent =
  | {
      type: 'RESET';
    }
  | {
      busy: boolean;
      type: 'LAYOUT_CHANGED';
    }
  | {
      atLatest?: boolean;
      latestTurnId: string;
      type: 'LAND_TO_LATEST';
    }
  | {
      atLatest: boolean;
      type: 'LANDING_DONE';
    }
  | {
      atLatest?: boolean;
      type: 'FOLLOW_BOTTOM';
    }
  | {
      atLatest?: boolean;
      type: 'ESCAPE_FOLLOW_BOTTOM';
    }
  | {
      atLatest?: boolean;
      type: 'PREPARE_LOCAL_APPEND';
    }
  | {
      atLatest?: boolean;
      latestTurnId: string;
      type: 'ANCHOR_TURN';
    }
  | {
      atLatest?: boolean;
      leftLatest?: boolean;
      retireTail?: boolean;
      type: 'ENTER_FREE';
    }
  | {
      atLatest: boolean;
      type: 'VIEWPORT_MEASURED';
    }
  | {
      type: 'TAIL_RETIRED';
    };

type TranscriptScrollSnapshot = {
  atLatest: boolean;
  mode: TranscriptScrollMode;
  showJumpToLatest: boolean;
};

const initialTranscriptScrollContext = {
  atLatest: true,
  hasLeftLatest: false,
  latestTurnId: null,
  layoutBusy: false,
  tailRetirement: 'idle',
} satisfies TranscriptScrollContext;

const transcriptScrollMachine = setup({
  types: {} as {
    context: TranscriptScrollContext;
    events: TranscriptScrollMachineEvent;
  },
  actions: {
    enterFreeContext: assign(({ context, event }) => {
      if (event.type !== 'ENTER_FREE') {
        return {};
      }

      const atLatest = event.atLatest ?? context.atLatest;

      return {
        atLatest,
        hasLeftLatest: event.leftLatest ?? (context.hasLeftLatest || !atLatest),
        tailRetirement: event.retireTail ? 'pending' : context.tailRetirement,
      };
    }),

    markTailRetired: assign(() => ({
      tailRetirement: 'idle' as const,
    })),

    resetContext: assign(() => ({ ...initialTranscriptScrollContext })),

    resetFreeContext: assign(() => ({
      hasLeftLatest: false,
      tailRetirement: 'idle' as const,
    })),

    setAtLatestFromOptionalEvent: assign(({ context, event }) => ({
      atLatest:
        'atLatest' in event && typeof event.atLatest === 'boolean'
          ? event.atLatest
          : context.atLatest,
    })),

    setAtLatestFromRequiredEvent: assign(({ context, event }) => ({
      atLatest:
        'atLatest' in event && typeof event.atLatest === 'boolean'
          ? event.atLatest
          : context.atLatest,
    })),

    setFreeViewportContext: assign(({ context, event }) => {
      if (event.type !== 'VIEWPORT_MEASURED') {
        return {};
      }

      return {
        atLatest: event.atLatest,
        hasLeftLatest: context.hasLeftLatest || !event.atLatest,
      };
    }),

    setLatestTurnIdFromEvent: assign(({ context, event }) => ({
      latestTurnId:
        'latestTurnId' in event && typeof event.latestTurnId === 'string'
          ? event.latestTurnId
          : context.latestTurnId,
    })),

    setLayoutBusy: assign(({ context, event }) => ({
      layoutBusy: event.type === 'LAYOUT_CHANGED' ? event.busy : context.layoutBusy,
    })),
  },
}).createMachine({
  id: 'transcript-scroll',
  initial: 'following-bottom',
  context: () => ({ ...initialTranscriptScrollContext }),
  on: {
    RESET: {
      target: '.following-bottom',
      actions: 'resetContext',
    },
    LAYOUT_CHANGED: {
      actions: 'setLayoutBusy',
    },
  },
  states: {
    'following-bottom': {
      on: {
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        ESCAPE_FOLLOW_BOTTOM: {
          target: 'escaping-follow-bottom',
          actions: 'setAtLatestFromOptionalEvent',
        },
        PREPARE_LOCAL_APPEND: {
          target: 'pre-anchoring-next-turn',
          actions: 'setAtLatestFromOptionalEvent',
        },
        ANCHOR_TURN: {
          target: 'anchored-turn',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent'],
        },
        FOLLOW_BOTTOM: {
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        VIEWPORT_MEASURED: {
          actions: 'setAtLatestFromRequiredEvent',
        },
      },
    },

    'landing-to-latest': {
      on: {
        LANDING_DONE: {
          target: 'following-bottom',
          actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
        },
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        ESCAPE_FOLLOW_BOTTOM: {
          target: 'escaping-follow-bottom',
          actions: 'setAtLatestFromOptionalEvent',
        },
        PREPARE_LOCAL_APPEND: {
          target: 'pre-anchoring-next-turn',
          actions: 'setAtLatestFromOptionalEvent',
        },
        VIEWPORT_MEASURED: {
          actions: 'setAtLatestFromRequiredEvent',
        },
      },
    },

    'escaping-follow-bottom': {
      on: {
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        FOLLOW_BOTTOM: {
          target: 'following-bottom',
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        PREPARE_LOCAL_APPEND: {
          target: 'pre-anchoring-next-turn',
          actions: 'setAtLatestFromOptionalEvent',
        },
        ANCHOR_TURN: {
          target: 'anchored-turn',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent'],
        },
        ENTER_FREE: {
          target: 'free',
          actions: 'enterFreeContext',
        },
        ESCAPE_FOLLOW_BOTTOM: {
          actions: 'setAtLatestFromOptionalEvent',
        },
        VIEWPORT_MEASURED: {
          actions: 'setAtLatestFromRequiredEvent',
        },
      },
    },

    'pre-anchoring-next-turn': {
      on: {
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        FOLLOW_BOTTOM: {
          target: 'following-bottom',
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        ANCHOR_TURN: {
          target: 'anchored-turn',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent'],
        },
        ENTER_FREE: {
          target: 'free',
          actions: 'enterFreeContext',
        },
        VIEWPORT_MEASURED: {
          actions: 'setAtLatestFromRequiredEvent',
        },
      },
    },

    'anchored-turn': {
      on: {
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        FOLLOW_BOTTOM: {
          target: 'following-bottom',
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        PREPARE_LOCAL_APPEND: {
          target: 'pre-anchoring-next-turn',
          actions: 'setAtLatestFromOptionalEvent',
        },
        ANCHOR_TURN: {
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent'],
        },
        ENTER_FREE: {
          target: 'free',
          actions: 'enterFreeContext',
        },
        VIEWPORT_MEASURED: {
          actions: 'setAtLatestFromRequiredEvent',
        },
      },
    },

    free: {
      on: {
        LAND_TO_LATEST: {
          target: 'landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        FOLLOW_BOTTOM: {
          target: 'following-bottom',
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
        PREPARE_LOCAL_APPEND: {
          target: 'pre-anchoring-next-turn',
          actions: 'setAtLatestFromOptionalEvent',
        },
        ANCHOR_TURN: {
          target: 'anchored-turn',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromOptionalEvent'],
        },
        ENTER_FREE: {
          actions: 'enterFreeContext',
        },
        VIEWPORT_MEASURED: {
          actions: 'setFreeViewportContext',
        },
        TAIL_RETIRED: {
          actions: 'markTailRetired',
        },
      },
    },
  },
});

type TranscriptScrollActorRef = ActorRefFrom<typeof transcriptScrollMachine>;
type TranscriptScrollMachineSnapshot = SnapshotFrom<typeof transcriptScrollMachine>;

type TranscriptScrollActorEnvironment = {
  collapseTailSpacer: () => void;
  latestTurnIndexRef: ReadonlyRef<number>;
  listRef: ReadonlyRef<VListHandle | null>;
  resetTailSpacerToEndRoom: () => void;
  setTailSpacerHeight: (height: number) => void;
  tailSpacerHeightRef: ReadonlyRef<number>;
  tailSpacerIndexRef: ReadonlyRef<number>;
};

type TranscriptScrollActor = {
  actorRef: TranscriptScrollActorRef;
  cancelPreparedLocalUserAppend: () => void;
  connect: (environment: TranscriptScrollActorEnvironment) => () => void;
  destroy: () => void;
  handleScroll: () => void;
  handleScrollEnd: () => void;
  jumpToLatest: () => void;
  markUserScrollIntent: () => void;
  prepareForLocalUserAppend: () => void;
  syncLatestTurnIdentity: (latestTurnId: string | null) => void;
  syncTranscriptLayout: (input: { busy: boolean }) => void;
};

type AssistantTurnSegment = {
  at: string;
  id: string;
  live: boolean;
  msg?: SyncMessage;
  parts: Part[];
  text: string;
};

type TranscriptTurn = {
  assistants: AssistantTurnSegment[];
  at: string;
  id: string;
  live: boolean;
  user: SyncMessage;
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
  staticData: {
    shell: shellRoutes.chat,
  },
  component: ThreadComponent,
});

function ThreadComponent() {
  const ctx = Route.useRouteContext();
  const params = Route.useParams();

  return <ThreadContent key={params.threadId} ownerId={ctx.user.id} threadId={params.threadId} />;
}

type ThreadContentProps = {
  ownerId: string;
  threadId: string;
};

function ThreadContent({ ownerId, threadId }: ThreadContentProps) {
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollActor = useTranscriptScrollActor();

  const rosterCollection = useMemo(() => roster(ownerId), [ownerId]);
  const activeRunsCollection = useMemo(() => active(ownerId, threadId), [ownerId, threadId]);
  const transcriptCollection = useMemo(() => transcript(ownerId, threadId), [ownerId, threadId]);

  const rosterQuery = useLiveQuery(rosterCollection);
  const activeRunsQuery = useLiveQuery(activeRunsCollection);
  const transcriptQuery = useLiveQuery(transcriptCollection);

  const thread = rosterQuery.data.find((row) => row.id === threadId);
  const threadGone = rosterQuery.isReady && !thread;
  const running = activeRunsQuery.data.length > 0;

  const pristine = !transcriptQuery.data.some(
    (msg) => msg.threadId === threadId && msg.role === 'user',
  );

  const submitUserMessage = useCallback(
    async (body: string) => {
      const content = body.trim();

      if (!thread || !content) {
        return;
      }

      scrollActor.prepareForLocalUserAppend();

      const now = new Date().toISOString();

      const transaction = messages(ownerId).insert({
        id: crypto.randomUUID(),
        threadId,
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
        scrollActor.cancelPreparedLocalUserAppend();
        setDraft((current) => current || content);
        setSendError(cause instanceof Error ? cause.message : 'Message send failed.');
        throw cause;
      });
    },
    [ownerId, scrollActor, thread, threadId],
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
        <p className="truncate text-[11px] text-muted-foreground">{threadId}</p>
      </header>

      <div className="relative h-full min-h-0">
        <TranscriptShell
          key={threadId}
          ownerId={ownerId}
          scrollActor={scrollActor}
          threadId={threadId}
        />
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

type TranscriptShellProps = {
  ownerId: string;
  scrollActor: TranscriptScrollActor;
  threadId: string;
};

const TranscriptShell = memo(function TranscriptShell({
  ownerId,
  scrollActor,
  threadId,
}: TranscriptShellProps) {
  const transcriptCollection = useMemo(() => transcript(ownerId, threadId), [ownerId, threadId]);
  const partsCollection = useMemo(() => pieces(ownerId, threadId), [ownerId, threadId]);

  const transcriptQuery = useLiveQuery(transcriptCollection);
  const partsQuery = useLiveQuery(partsCollection);

  const rawMessages = transcriptQuery.data;
  const rawParts = partsQuery.data;

  const hasForeignMessages = rawMessages.some((msg) => msg.threadId !== threadId);

  const hasExplicitForeignParts = rawParts.some((part) => {
    const partThreadId = explicitPartThreadId(part);
    return typeof partThreadId === 'string' && partThreadId !== threadId;
  });

  const scopedMessages = useMemo(
    () => rawMessages.filter((msg) => msg.threadId === threadId),
    [rawMessages, threadId],
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
        isPartForCurrentThread(part, threadId, scopedMessageIds, scopedRunIds),
      ),
    [rawParts, threadId, scopedMessageIds, scopedRunIds],
  );

  const ready =
    transcriptQuery.isReady &&
    partsQuery.isReady &&
    !hasForeignMessages &&
    !hasExplicitForeignParts;

  const turns = useMemo(() => {
    if (!ready) {
      return [];
    }

    return materializeTranscriptTurns(scopedMessages, scopedParts);
  }, [ready, scopedMessages, scopedParts]);

  if (!ready) {
    return <TranscriptLoadingFrame />;
  }

  const busy = turns.some((turn) => turn.live);

  return (
    <TranscriptVirtuaList busy={busy} scrollActor={scrollActor} threadId={threadId} turns={turns} />
  );
});

type TranscriptLoadingFrameProps = ComponentPropsWithoutRef<'div'>;

function TranscriptLoadingFrame({ className, ...props }: TranscriptLoadingFrameProps) {
  return (
    <div className={cn('h-full min-h-0 overflow-hidden px-3 pt-6', className)} {...props}>
      <div className="mx-auto min-h-20 w-full max-w-3xl" />
    </div>
  );
}

type TranscriptVirtuaListProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  busy: boolean;
  scrollActor: TranscriptScrollActor;
  threadId: string;
  turns: TranscriptTurn[];
};

function TranscriptVirtuaList({
  busy,
  className,
  onKeyDown,
  onPointerDown,
  onTouchMove,
  onWheel,
  scrollActor,
  threadId,
  turns,
  ...props
}: TranscriptVirtuaListProps) {
  const listRef = useRef<VListHandle>(null);
  const latestTurnIndexRef = useRef(-1);
  const tailSpacerIndexRef = useRef(0);

  const {
    collapse: collapseTailSpacer,
    height: tailSpacerHeight,
    heightRef: tailSpacerHeightRef,
    resetToEndRoom,
    setHeight: setTailSpacerHeight,
  } = useTranscriptTailSpacer();

  const latestTurnIndex = turns.length - 1;
  const latestTurnId = latestTurnIndex >= 0 ? (turns[latestTurnIndex]?.id ?? null) : null;
  const tailSpacerIndex = turns.length;
  const childCount = turns.length + 1;

  latestTurnIndexRef.current = latestTurnIndex;
  tailSpacerIndexRef.current = tailSpacerIndex;

  const actorEnvironment = useMemo(
    () => ({
      collapseTailSpacer,
      latestTurnIndexRef,
      listRef,
      resetTailSpacerToEndRoom: resetToEndRoom,
      setTailSpacerHeight,
      tailSpacerHeightRef,
      tailSpacerIndexRef,
    }),
    [
      collapseTailSpacer,
      latestTurnIndexRef,
      listRef,
      resetToEndRoom,
      setTailSpacerHeight,
      tailSpacerHeightRef,
      tailSpacerIndexRef,
    ],
  );

  const snapshot = useSelector(scrollActor.actorRef, selectTranscriptScrollSnapshot);

  const keepMounted = useMemo(
    () =>
      [...new Set([latestTurnIndex - 1, latestTurnIndex, tailSpacerIndex])].filter(
        (index) => index >= 0 && index < childCount,
      ),
    [childCount, latestTurnIndex, tailSpacerIndex],
  );

  useLayoutEffect(() => scrollActor.connect(actorEnvironment), [actorEnvironment, scrollActor]);

  useLayoutEffect(() => {
    scrollActor.syncLatestTurnIdentity(latestTurnId);
  }, [latestTurnId, scrollActor]);

  useLayoutEffect(() => {
    scrollActor.syncTranscriptLayout({ busy });
  }, [busy, scrollActor, turns]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      onWheel?.(event);

      if (!event.defaultPrevented) {
        scrollActor.markUserScrollIntent();
      }
    },
    [onWheel, scrollActor],
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      onTouchMove?.(event);

      if (!event.defaultPrevented) {
        scrollActor.markUserScrollIntent();
      }
    },
    [onTouchMove, scrollActor],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerDown?.(event);
    },
    [onPointerDown],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);

      if (!event.defaultPrevented && USER_SCROLL_KEYS.has(event.key)) {
        scrollActor.markUserScrollIntent();
      }
    },
    [onKeyDown, scrollActor],
  );

  if (!turns.length) {
    return <TranscriptEmptyState />;
  }

  return (
    <div
      className={cn('relative h-full min-h-0', className)}
      data-at-latest={snapshot.atLatest ? 'true' : 'false'}
      data-scroll-mode={snapshot.mode}
      data-tail-spacer-state={tailSpacerState(tailSpacerHeight)}
      data-thread-id={threadId}
      data-transcript-shell=""
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onTouchMove={handleTouchMove}
      onWheel={handleWheel}
      {...props}
    >
      <VList
        ref={listRef}
        aria-atomic={false}
        aria-busy={busy}
        aria-label="Conversation transcript"
        aria-live="polite"
        aria-relevant="additions text"
        bufferSize={TRANSCRIPT_BUFFER_SIZE}
        className="h-full min-h-0 overflow-y-auto px-3 pt-6 [overflow-anchor:none] scrollbar-gutter-both"
        data-transcript-viewport=""
        keepMounted={keepMounted}
        role="log"
        tabIndex={0}
        onScroll={scrollActor.handleScroll}
        onScrollEnd={scrollActor.handleScrollEnd}
      >
        {turns.map((turn, index) => (
          <TranscriptTurnItem
            key={turn.id}
            gap={turnGap(turn, turns[index - 1])}
            index={index}
            setSize={turns.length}
            turn={turn}
          />
        ))}

        <TranscriptTailSpacer key={TRANSCRIPT_TAIL_SPACER_KEY} height={tailSpacerHeight} />
      </VList>

      <JumpToLatestHud show={snapshot.showJumpToLatest} onJumpToLatest={scrollActor.jumpToLatest} />
    </div>
  );
}

function selectTranscriptScrollSnapshot(
  snapshot: TranscriptScrollMachineSnapshot,
): TranscriptScrollSnapshot {
  const mode = snapshot.value as TranscriptScrollMode;
  const { atLatest, hasLeftLatest } = snapshot.context;

  const showJumpToLatest =
    !atLatest &&
    (mode === 'anchored-turn' ||
      mode === 'escaping-follow-bottom' ||
      (mode === 'free' && hasLeftLatest));

  return {
    atLatest,
    mode,
    showJumpToLatest,
  };
}

type TranscriptEmptyStateProps = ComponentPropsWithoutRef<'div'>;

function TranscriptEmptyState({ className, ...props }: TranscriptEmptyStateProps) {
  return (
    <div className={cn('h-full min-h-0 overflow-hidden px-3 pt-6', className)} {...props}>
      <div className="mx-auto grid min-h-64 w-full max-w-3xl place-items-center">
        <p className="text-sm text-muted-foreground">Send the first message.</p>
      </div>
    </div>
  );
}

function useTranscriptScrollActor() {
  const actorRef = useActorRef(
    transcriptScrollMachine,
    transcriptScrollInspect ? { inspect: transcriptScrollInspect } : undefined,
  );

  const actor = useMemo(() => createTranscriptScrollActor(actorRef), [actorRef]);

  useLayoutEffect(() => {
    return () => {
      actor.destroy();
    };
  }, [actor]);

  return actor;
}

function createTranscriptScrollActor(actorRef: TranscriptScrollActorRef): TranscriptScrollActor {
  let environment: TranscriptScrollActorEnvironment | null = null;
  let programmaticScroll = false;
  let userScrollIntent = false;
  let programmaticScrollClearTimer: number | null = null;
  let measureFrame: number | null = null;
  let settleFrame: number | null = null;
  let postSpacerFrame: number | null = null;
  let bottomPinFrame: number | null = null;
  let bottomSettleFrame: number | null = null;
  let latestLandingFrame: number | null = null;
  let latestLandingSettleFrame: number | null = null;
  let passiveProbeFrame: number | null = null;
  let passiveProbeSettleFrame: number | null = null;
  let tailRetirementFrame: number | null = null;

  function currentMode() {
    return actorRef.getSnapshot().value as TranscriptScrollMode;
  }

  function currentContext() {
    return actorRef.getSnapshot().context;
  }

  function send(event: TranscriptScrollMachineEvent) {
    actorRef.send(event);
  }

  function cancelProgrammaticScrollAuthority() {
    programmaticScroll = false;

    if (programmaticScrollClearTimer !== null) {
      window.clearTimeout(programmaticScrollClearTimer);
      programmaticScrollClearTimer = null;
    }
  }

  function cancelScheduledScrollFrames() {
    if (measureFrame !== null) {
      window.cancelAnimationFrame(measureFrame);
      measureFrame = null;
    }

    if (settleFrame !== null) {
      window.cancelAnimationFrame(settleFrame);
      settleFrame = null;
    }

    if (postSpacerFrame !== null) {
      window.cancelAnimationFrame(postSpacerFrame);
      postSpacerFrame = null;
    }
  }

  function cancelBottomPinFrames() {
    if (bottomPinFrame !== null) {
      window.cancelAnimationFrame(bottomPinFrame);
      bottomPinFrame = null;
    }

    if (bottomSettleFrame !== null) {
      window.cancelAnimationFrame(bottomSettleFrame);
      bottomSettleFrame = null;
    }
  }

  function cancelLatestLandingFrames() {
    if (latestLandingFrame !== null) {
      window.cancelAnimationFrame(latestLandingFrame);
      latestLandingFrame = null;
    }

    if (latestLandingSettleFrame !== null) {
      window.cancelAnimationFrame(latestLandingSettleFrame);
      latestLandingSettleFrame = null;
    }
  }

  function cancelLatestLanding() {
    cancelLatestLandingFrames();
  }

  function cancelPassiveViewportProbe() {
    if (passiveProbeFrame !== null) {
      window.cancelAnimationFrame(passiveProbeFrame);
      passiveProbeFrame = null;
    }

    if (passiveProbeSettleFrame !== null) {
      window.cancelAnimationFrame(passiveProbeSettleFrame);
      passiveProbeSettleFrame = null;
    }
  }

  function cancelTailRetirement() {
    if (tailRetirementFrame !== null) {
      window.cancelAnimationFrame(tailRetirementFrame);
      tailRetirementFrame = null;
    }
  }

  function enterFollowingBottom(atLatest?: boolean) {
    cancelPassiveViewportProbe();
    cancelTailRetirement();
    environment?.resetTailSpacerToEndRoom();

    send({
      atLatest,
      type: 'FOLLOW_BOTTOM',
    });
  }

  function clearProgrammaticScrollSoon() {
    if (programmaticScrollClearTimer !== null) {
      window.clearTimeout(programmaticScrollClearTimer);
    }

    programmaticScrollClearTimer = window.setTimeout(() => {
      programmaticScroll = false;
      programmaticScrollClearTimer = null;
    }, TRANSCRIPT_SCROLL_SETTLE_DELAY);
  }

  function performProgrammaticScroll(fn: () => void) {
    programmaticScroll = true;
    fn();
    clearProgrammaticScrollSoon();
  }

  function scheduleAfterVirtuaLayout(fn: () => void) {
    cancelScheduledScrollFrames();

    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = null;

      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = null;
        fn();
      });
    });
  }

  function isNearLatest() {
    const list = environment?.listRef.current;

    if (!list || list.viewportSize === 0) {
      return true;
    }

    const viewportBottom = list.scrollOffset + list.viewportSize;

    return Math.abs(list.scrollSize - viewportBottom) <= TRANSCRIPT_EDGE_THRESHOLD;
  }

  function commitViewportState() {
    send({
      atLatest: isNearLatest(),
      type: 'VIEWPORT_MEASURED',
    });
  }

  function runPassiveViewportProbe() {
    const mode = currentMode();

    if (
      mode === 'following-bottom' ||
      mode === 'landing-to-latest' ||
      mode === 'pre-anchoring-next-turn'
    ) {
      return;
    }

    const nearLatest = isNearLatest();

    if (mode === 'free') {
      reconcileFreeScroll(nearLatest);
      return;
    }

    if (mode === 'escaping-follow-bottom') {
      if (!nearLatest) {
        send({
          atLatest: false,
          leftLatest: true,
          type: 'ENTER_FREE',
        });
      } else {
        send({
          atLatest: true,
          type: 'VIEWPORT_MEASURED',
        });
      }

      return;
    }

    send({
      atLatest: nearLatest,
      type: 'VIEWPORT_MEASURED',
    });
  }

  function schedulePassiveViewportProbe() {
    const mode = currentMode();

    if (
      mode === 'following-bottom' ||
      mode === 'landing-to-latest' ||
      mode === 'pre-anchoring-next-turn'
    ) {
      return;
    }

    if (passiveProbeFrame !== null || passiveProbeSettleFrame !== null) {
      return;
    }

    passiveProbeFrame = window.requestAnimationFrame(() => {
      passiveProbeFrame = null;

      passiveProbeSettleFrame = window.requestAnimationFrame(() => {
        passiveProbeSettleFrame = null;
        runPassiveViewportProbe();
      });
    });
  }

  function reserveTailForPendingLocalAppend() {
    const list = environment?.listRef.current;
    const viewportSize = list?.viewportSize ?? 0;

    const preAnchorHeight = Math.max(
      TRANSCRIPT_END_BREATHING_ROOM,
      TRANSCRIPT_MIN_ANCHOR_SPACER,
      viewportSize > 0 ? viewportSize - TRANSCRIPT_PREVIOUS_TURN_PEEK : 0,
    );

    if (environment && environment.tailSpacerHeightRef.current < preAnchorHeight) {
      environment.setTailSpacerHeight(preAnchorHeight);
    }
  }

  function requiredTailSpacerHeightForTurn(turnIndex: number) {
    const list = environment?.listRef.current;

    if (!environment || !list || turnIndex < 0 || list.viewportSize === 0) {
      return TRANSCRIPT_END_BREATHING_ROOM;
    }

    const targetScrollTop = Math.max(
      0,
      list.getItemOffset(turnIndex) - TRANSCRIPT_PREVIOUS_TURN_PEEK,
    );

    const currentTailSpacerHeight = environment.tailSpacerHeightRef.current;
    const baseScrollSize = Math.max(0, list.scrollSize - currentTailSpacerHeight);
    const baseMaxScrollTop = Math.max(0, baseScrollSize - list.viewportSize);
    const requiredExtraHeight = Math.max(0, targetScrollTop - baseMaxScrollTop);

    if (requiredExtraHeight <= 0) {
      return TRANSCRIPT_END_BREATHING_ROOM;
    }

    return Math.max(
      TRANSCRIPT_END_BREATHING_ROOM,
      TRANSCRIPT_MIN_ANCHOR_SPACER,
      Math.ceil(requiredExtraHeight),
    );
  }

  function scrollToLatestIndexNow({ smooth = false }: { smooth?: boolean } = {}) {
    if (!environment || environment.latestTurnIndexRef.current < 0) {
      return;
    }

    environment.resetTailSpacerToEndRoom();

    performProgrammaticScroll(() => {
      environment?.listRef.current?.scrollToIndex(environment.tailSpacerIndexRef.current, {
        align: 'end',
        smooth,
      });
    });

    commitViewportState();
  }

  function landToLatest({
    immediate = false,
    smooth = false,
  }: {
    immediate?: boolean;
    smooth?: boolean;
  } = {}) {
    if (!environment || environment.latestTurnIndexRef.current < 0) {
      return;
    }

    cancelPassiveViewportProbe();
    cancelLatestLandingFrames();
    cancelBottomPinFrames();
    environment.resetTailSpacerToEndRoom();

    if (immediate) {
      scrollToLatestIndexNow();
    }

    latestLandingFrame = window.requestAnimationFrame(() => {
      latestLandingFrame = null;

      latestLandingSettleFrame = window.requestAnimationFrame(() => {
        latestLandingSettleFrame = null;
        scrollToLatestIndexNow({ smooth });

        send({
          atLatest: isNearLatest(),
          type: 'LANDING_DONE',
        });
      });
    });
  }

  function pinToLatestNow() {
    const list = environment?.listRef.current;

    if (!environment || !list || environment.latestTurnIndexRef.current < 0) {
      return;
    }

    if (list.viewportSize === 0) {
      return;
    }

    environment.resetTailSpacerToEndRoom();

    performProgrammaticScroll(() => {
      list.scrollTo(Math.max(0, list.scrollSize - list.viewportSize));
    });

    commitViewportState();
  }

  function settlePinnedToLatest() {
    cancelBottomPinFrames();

    bottomPinFrame = window.requestAnimationFrame(() => {
      bottomPinFrame = null;
      pinToLatestNow();

      bottomSettleFrame = window.requestAnimationFrame(() => {
        bottomSettleFrame = null;
        pinToLatestNow();
      });
    });
  }

  function anchorLatestTurn({
    allowSpacerShrink = false,
    immediate = false,
  }: {
    allowSpacerShrink?: boolean;
    immediate?: boolean;
  } = {}) {
    if (!environment || environment.latestTurnIndexRef.current < 0) {
      return;
    }

    const turnIndex = environment.latestTurnIndexRef.current;

    if (immediate) {
      performProgrammaticScroll(() => {
        environment?.listRef.current?.scrollToIndex(turnIndex, {
          align: 'start',
          offset: -TRANSCRIPT_PREVIOUS_TURN_PEEK,
        });
      });
    }

    scheduleAfterVirtuaLayout(() => {
      if (!environment) {
        return;
      }

      const requiredHeight = requiredTailSpacerHeightForTurn(turnIndex);

      const nextTailSpacerHeight = allowSpacerShrink
        ? requiredHeight
        : Math.max(environment.tailSpacerHeightRef.current, requiredHeight);

      environment.setTailSpacerHeight(nextTailSpacerHeight);

      postSpacerFrame = window.requestAnimationFrame(() => {
        postSpacerFrame = null;

        performProgrammaticScroll(() => {
          environment?.listRef.current?.scrollToIndex(turnIndex, {
            align: 'start',
            offset: -TRANSCRIPT_PREVIOUS_TURN_PEEK,
          });
        });

        commitViewportState();
      });
    });
  }

  function canRetireTailSpacerNow() {
    const list = environment?.listRef.current;
    const context = currentContext();

    if (!environment || !list) {
      return false;
    }

    const extraTailHeight = Math.max(
      0,
      environment.tailSpacerHeightRef.current - TRANSCRIPT_END_BREATHING_ROOM,
    );

    if (currentMode() !== 'free' || context.tailRetirement !== 'pending' || extraTailHeight <= 0) {
      return false;
    }

    if (list.viewportSize === 0) {
      return false;
    }

    const tailTop = list.getItemOffset(environment.tailSpacerIndexRef.current);
    const viewportBottom = list.scrollOffset + list.viewportSize;

    if (tailTop < viewportBottom + TRANSCRIPT_TAIL_RETIRE_MARGIN) {
      return false;
    }

    const currentMaxScrollTop = Math.max(0, list.scrollSize - list.viewportSize);
    const nextMaxScrollTop = Math.max(0, currentMaxScrollTop - extraTailHeight);

    return list.scrollOffset <= nextMaxScrollTop;
  }

  function retireTailSpacerIfInvisible() {
    if (!environment || !canRetireTailSpacerNow() || tailRetirementFrame !== null) {
      return;
    }

    tailRetirementFrame = window.requestAnimationFrame(() => {
      tailRetirementFrame = null;

      if (!environment || !canRetireTailSpacerNow()) {
        return;
      }

      environment.setTailSpacerHeight(TRANSCRIPT_END_BREATHING_ROOM);
      send({ type: 'TAIL_RETIRED' });
    });
  }

  function maybeReturnToFollowingBottom() {
    const context = currentContext();

    if (!environment || currentMode() !== 'free') {
      return false;
    }

    if (!context.hasLeftLatest) {
      return false;
    }

    if (environment.tailSpacerHeightRef.current > TRANSCRIPT_END_BREATHING_ROOM) {
      return false;
    }

    if (!isNearLatest()) {
      return false;
    }

    enterFollowingBottom(true);
    return true;
  }

  function reconcileFreeScroll(nearLatest: boolean) {
    if (!nearLatest) {
      send({
        atLatest: false,
        type: 'VIEWPORT_MEASURED',
      });

      retireTailSpacerIfInvisible();
      return;
    }

    maybeReturnToFollowingBottom();
  }

  return {
    actorRef,

    cancelPreparedLocalUserAppend() {
      if (currentMode() !== 'pre-anchoring-next-turn') {
        return;
      }

      const latestTurnId = currentContext().latestTurnId;

      if (!latestTurnId) {
        enterFollowingBottom();
        return;
      }

      send({
        atLatest: isNearLatest(),
        latestTurnId,
        type: 'LAND_TO_LATEST',
      });

      landToLatest({ immediate: true });
    },

    connect(nextEnvironment) {
      environment = nextEnvironment;

      if (currentMode() === 'pre-anchoring-next-turn') {
        reserveTailForPendingLocalAppend();
      }

      if (currentMode() === 'landing-to-latest') {
        landToLatest({ immediate: true });
      }

      return () => {
        if (environment === nextEnvironment) {
          environment = null;
        }
      };
    },

    destroy() {
      cancelProgrammaticScrollAuthority();
      cancelScheduledScrollFrames();
      cancelBottomPinFrames();
      cancelLatestLanding();
      cancelPassiveViewportProbe();
      cancelTailRetirement();
      userScrollIntent = false;
      environment = null;
    },

    handleScroll() {
      const nearLatest = isNearLatest();
      const mode = currentMode();

      if (userScrollIntent) {
        userScrollIntent = false;
        cancelProgrammaticScrollAuthority();

        if (mode === 'escaping-follow-bottom') {
          if (!nearLatest) {
            send({
              atLatest: false,
              leftLatest: true,
              type: 'ENTER_FREE',
            });
          }

          commitViewportState();
          return;
        }

        if (mode === 'anchored-turn' || mode === 'pre-anchoring-next-turn') {
          send({
            atLatest: nearLatest,
            leftLatest: !nearLatest,
            retireTail: true,
            type: 'ENTER_FREE',
          });

          reconcileFreeScroll(nearLatest);
          commitViewportState();
          return;
        }

        if (mode === 'free') {
          reconcileFreeScroll(nearLatest);
          commitViewportState();
          return;
        }

        if (nearLatest) {
          enterFollowingBottom(true);
        } else {
          send({
            atLatest: false,
            leftLatest: true,
            type: 'ENTER_FREE',
          });

          reconcileFreeScroll(false);
        }

        commitViewportState();
        return;
      }

      if (programmaticScroll) {
        commitViewportState();
        return;
      }

      if (mode === 'escaping-follow-bottom' && !nearLatest) {
        send({
          atLatest: false,
          leftLatest: true,
          type: 'ENTER_FREE',
        });

        commitViewportState();
        return;
      }

      if (mode === 'free') {
        reconcileFreeScroll(nearLatest);
      }

      commitViewportState();
    },

    handleScrollEnd() {
      cancelProgrammaticScrollAuthority();

      const mode = currentMode();

      if (mode === 'escaping-follow-bottom') {
        if (isNearLatest()) {
          enterFollowingBottom(true);
        } else {
          send({
            atLatest: false,
            leftLatest: true,
            type: 'ENTER_FREE',
          });
        }

        commitViewportState();
        return;
      }

      if (mode === 'free') {
        reconcileFreeScroll(isNearLatest());
        commitViewportState();
        return;
      }

      if (
        mode !== 'anchored-turn' &&
        mode !== 'pre-anchoring-next-turn' &&
        mode !== 'landing-to-latest' &&
        isNearLatest()
      ) {
        enterFollowingBottom(true);
      }

      commitViewportState();
    },

    jumpToLatest() {
      const latestTurnId = currentContext().latestTurnId;

      if (!latestTurnId) {
        return;
      }

      userScrollIntent = false;
      cancelScheduledScrollFrames();
      cancelBottomPinFrames();
      cancelPassiveViewportProbe();

      send({
        atLatest: isNearLatest(),
        latestTurnId,
        type: 'LAND_TO_LATEST',
      });

      landToLatest({ smooth: true });
    },

    markUserScrollIntent() {
      userScrollIntent = true;
      cancelProgrammaticScrollAuthority();
      cancelScheduledScrollFrames();
      cancelBottomPinFrames();
      cancelLatestLanding();
      cancelPassiveViewportProbe();

      const mode = currentMode();

      if (mode === 'following-bottom' || mode === 'landing-to-latest') {
        send({
          atLatest: isNearLatest(),
          type: 'ESCAPE_FOLLOW_BOTTOM',
        });
      }
    },

    prepareForLocalUserAppend() {
      cancelLatestLanding();
      cancelPassiveViewportProbe();
      cancelTailRetirement();
      cancelScheduledScrollFrames();
      cancelBottomPinFrames();
      userScrollIntent = false;
      reserveTailForPendingLocalAppend();

      send({
        atLatest: isNearLatest(),
        type: 'PREPARE_LOCAL_APPEND',
      });
    },

    syncLatestTurnIdentity(nextLatestTurnId) {
      if (!nextLatestTurnId) {
        cancelLatestLanding();
        cancelPassiveViewportProbe();
        cancelTailRetirement();
        cancelScheduledScrollFrames();
        cancelBottomPinFrames();
        environment?.collapseTailSpacer();
        send({ type: 'RESET' });
        return;
      }

      const context = currentContext();

      if (!context.latestTurnId) {
        send({
          atLatest: isNearLatest(),
          latestTurnId: nextLatestTurnId,
          type: 'LAND_TO_LATEST',
        });

        landToLatest({ immediate: true });
        return;
      }

      if (context.latestTurnId !== nextLatestTurnId) {
        const shouldAnchorImmediately = currentMode() === 'pre-anchoring-next-turn';

        cancelLatestLanding();
        cancelPassiveViewportProbe();
        cancelTailRetirement();

        send({
          atLatest: isNearLatest(),
          latestTurnId: nextLatestTurnId,
          type: 'ANCHOR_TURN',
        });

        anchorLatestTurn({
          allowSpacerShrink: true,
          immediate: shouldAnchorImmediately,
        });
      }
    },

    syncTranscriptLayout({ busy }) {
      const context = currentContext();
      const mode = currentMode();
      const streamJustSettled = context.layoutBusy && !busy;

      send({
        busy,
        type: 'LAYOUT_CHANGED',
      });

      if (mode === 'following-bottom') {
        cancelPassiveViewportProbe();
        pinToLatestNow();
        settlePinnedToLatest();
        return;
      }

      if (mode === 'landing-to-latest') {
        return;
      }

      if (mode === 'escaping-follow-bottom') {
        if (streamJustSettled && isNearLatest()) {
          cancelPassiveViewportProbe();
          pinToLatestNow();
          settlePinnedToLatest();
          return;
        }

        if (!isNearLatest()) {
          send({
            atLatest: false,
            leftLatest: true,
            type: 'ENTER_FREE',
          });
        }

        schedulePassiveViewportProbe();
        return;
      }

      if (mode === 'free') {
        schedulePassiveViewportProbe();
        retireTailSpacerIfInvisible();
        return;
      }

      if (mode === 'anchored-turn') {
        schedulePassiveViewportProbe();
      }
    },
  };
}

type TranscriptTailSpacerState = 'anchoring' | 'collapsed' | 'idle';

function useTranscriptTailSpacer() {
  const [height, setHeightState] = useState(TRANSCRIPT_END_BREATHING_ROOM);
  const heightRef = useRef(TRANSCRIPT_END_BREATHING_ROOM);

  const setHeight = useCallback((height: number) => {
    const nextHeight = Math.max(0, Math.ceil(height));

    if (heightRef.current === nextHeight) {
      return;
    }

    heightRef.current = nextHeight;
    setHeightState(nextHeight);
  }, []);

  const resetToEndRoom = useCallback(() => {
    setHeight(TRANSCRIPT_END_BREATHING_ROOM);
  }, [setHeight]);

  const collapse = useCallback(() => {
    setHeight(0);
  }, [setHeight]);

  return useMemo(
    () => ({
      collapse,
      height,
      heightRef,
      resetToEndRoom,
      setHeight,
    }),
    [collapse, height, resetToEndRoom, setHeight],
  );
}

type TranscriptTailSpacerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  height: number;
};

const TranscriptTailSpacer = memo(
  forwardRef<HTMLDivElement, TranscriptTailSpacerProps>(function TranscriptTailSpacer(
    { className, height, style, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          'pointer-events-none h-(--transcript-tail-spacer-height,0px) shrink-0',
          className,
        )}
        data-state={tailSpacerState(height)}
        data-transcript-tail-spacer=""
        style={
          {
            ...style,
            '--transcript-tail-spacer-height': `${height}px`,
          } as CssVars
        }
        {...props}
      />
    );
  }),
);

TranscriptTailSpacer.displayName = 'TranscriptTailSpacer';

function tailSpacerState(height: number): TranscriptTailSpacerState {
  if (height > TRANSCRIPT_END_BREATHING_ROOM) {
    return 'anchoring';
  }

  if (height > 0) {
    return 'idle';
  }

  return 'collapsed';
}

type TranscriptTurnItemProps = Omit<ComponentPropsWithoutRef<'article'>, 'children'> & {
  gap: number;
  index: number;
  setSize: number;
  turn: TranscriptTurn;
};

const TranscriptTurnItem = memo(
  forwardRef<HTMLElement, TranscriptTurnItemProps>(function TranscriptTurnItem(
    { className, gap, index, setSize, style, turn, ...props },
    ref,
  ) {
    const turnNumber = index + 1;

    return (
      <article
        ref={ref}
        aria-label={`Conversation turn ${turnNumber} of ${setSize}`}
        className={cn(
          'mx-auto flow-root w-full max-w-3xl min-w-0 pt-(--transcript-turn-gap,0px)',
          className,
        )}
        data-scroll-anchor="true"
        data-transcript-turn=""
        data-turn-id={turn.id}
        data-turn-index={index}
        data-turn-live={turn.live ? 'true' : 'false'}
        data-turn-state={turn.live ? 'streaming' : 'settled'}
        style={
          {
            ...style,
            '--transcript-turn-gap': `${gap}px`,
          } as CssVars
        }
        {...props}
      >
        <TranscriptTurnView turn={turn} />
      </article>
    );
  }),
);

TranscriptTurnItem.displayName = 'TranscriptTurnItem';

type TranscriptTurnViewProps = {
  turn: TranscriptTurn;
};

function TranscriptTurnView({ turn }: TranscriptTurnViewProps) {
  return (
    <div className="space-y-8">
      <UserMessage msg={turn.user} />
      <AssistantSegments segments={turn.assistants} />
    </div>
  );
}

type AssistantSegmentsProps = {
  segments: AssistantTurnSegment[];
};

function AssistantSegments({ segments }: AssistantSegmentsProps) {
  if (!segments.length) {
    return null;
  }

  return (
    <div className="space-y-4">
      {segments.map((segment) => (
        <AssistantMessage key={segment.id} segment={segment} />
      ))}
    </div>
  );
}

function turnGap(turn: TranscriptTurn | undefined, previousTurn: TranscriptTurn | undefined) {
  if (!turn || !previousTurn) {
    return 0;
  }

  if (turn.assistants.length === 0) {
    return 28;
  }

  return 36;
}

type JumpToLatestHudProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  buttonProps?: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'onClick' | 'type'>;
  onJumpToLatest: () => void;
  show: boolean;
};

function JumpToLatestHud({
  buttonProps,
  className,
  onJumpToLatest,
  show,
  ...props
}: JumpToLatestHudProps) {
  const {
    className: buttonClassName,
    onKeyDown,
    onPointerDown,
    onTouchMove,
    onWheel,
    ...buttonPropsRest
  } = buttonProps ?? {};

  return (
    <div
      aria-hidden={!show}
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4',
        'transition duration-200 ease-out',
        show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
        className,
      )}
      data-state={show ? 'open' : 'closed'}
      {...props}
    >
      <button
        {...buttonPropsRest}
        type="button"
        aria-label={buttonPropsRest['aria-label'] ?? 'Jump to latest'}
        className={cn(
          'grid size-10 place-items-center rounded-full border border-line',
          'bg-background/90 text-foreground shadow-sm backdrop-blur',
          'transition duration-200 ease-out',
          'hover:bg-surface-raised hover:shadow-md',
          'active:translate-y-0.5',
          show ? 'pointer-events-auto scale-100' : 'pointer-events-none scale-95',
          buttonClassName,
        )}
        tabIndex={show ? (buttonPropsRest.tabIndex ?? 0) : -1}
        title={buttonPropsRest.title ?? 'Jump to latest'}
        onClick={(event) => {
          event.stopPropagation();
          onJumpToLatest();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          onKeyDown?.(event);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown?.(event);
        }}
        onTouchMove={(event) => {
          event.stopPropagation();
          onTouchMove?.(event);
        }}
        onWheel={(event) => {
          event.stopPropagation();
          onWheel?.(event);
        }}
      >
        <LatestIcon className="size-4" />
      </button>
    </div>
  );
}

type UserMessageProps = {
  msg: SyncMessage;
};

function UserMessage({ msg }: UserMessageProps) {
  return (
    <Message align="end" className="px-0">
      <MessageContent className="max-w-[min(80%,44rem)]">
        <Bubble
          align="end"
          className="max-w-none border border-line bg-row shadow-none"
          variant="secondary"
        >
          <BubbleContent className="px-3.5 py-2">
            <Markdown
              className="text-sm leading-7 wrap-anywhere [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              text={msg.content}
            />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

type AssistantMessageProps = {
  segment: AssistantTurnSegment;
};

function AssistantMessage({ segment }: AssistantMessageProps) {
  return (
    <Message align="start" className="px-0">
      <MessageContent className="w-full min-w-0">
        <Bubble className="w-full max-w-none" variant="ghost">
          <BubbleContent className="w-full max-w-none p-0">
            <AssistantTurn segment={segment} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

type AssistantTurnProps = {
  segment: AssistantTurnSegment;
};

function AssistantTurn({ segment }: AssistantTurnProps) {
  if (!segment.parts.length) {
    return (
      <div className="flow-root min-w-0 max-w-full">
        <Markdown live={segment.live} text={segment.text} />
      </div>
    );
  }

  return (
    <div className="flow-root min-w-0 max-w-full space-y-3">
      {segment.parts.map((part) => (
        <AssistantPart key={part.id} live={part.status === 'running'} part={part} />
      ))}
    </div>
  );
}

type AssistantPartProps = {
  live: boolean;
  part: Part;
};

function AssistantPart({ live, part }: AssistantPartProps) {
  if (part.kind === 'text') {
    return <Markdown live={live} text={partContent(part)} />;
  }

  if (part.kind === 'reasoning') {
    return <ReasoningPart live={live} part={part} />;
  }

  return <StructuredPart part={part} />;
}

type DisclosureProps = Omit<ComponentPropsWithoutRef<'details'>, 'open'> & {
  defaultOpen?: boolean;
  forceOpen?: boolean;
};

function Disclosure({
  children,
  defaultOpen = false,
  forceOpen = false,
  onToggle,
  ...props
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const effectiveOpen = forceOpen || open;

  return (
    <details
      {...props}
      open={effectiveOpen}
      onToggle={(event) => {
        onToggle?.(event);

        if (forceOpen || event.defaultPrevented) {
          return;
        }

        setOpen(event.currentTarget.open);
      }}
    >
      {children}
    </details>
  );
}

type ReasoningPartProps = {
  live?: boolean;
  part: Part;
};

function ReasoningPart({ live, part }: ReasoningPartProps) {
  const running = part.status === 'running';

  return (
    <Disclosure
      className="flow-root min-w-0 max-w-full rounded-xl border border-line bg-surface/80 p-3 text-xs"
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
      <Markdown live={live} text={partContent(part)} />
    </Disclosure>
  );
}

type StructuredPartProps = {
  part: Part;
};

function StructuredPart({ part }: StructuredPartProps) {
  const body = structuredPartBody(part);
  const running = part.status === 'running';

  return (
    <Disclosure
      className="my-2 flow-root min-w-0 max-w-full rounded-xl border border-line bg-surface/85 text-xs"
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0 truncate font-mono text-xs font-semibold">
          {structuredPartTitle(part)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{part.status}</span>
      </summary>

      {body ? (
        <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap border-t border-line bg-surface-raised px-4 py-3 leading-5 wrap-anywhere">
          {body}
        </pre>
      ) : null}
    </Disclosure>
  );
}

type MarkdownProps = {
  className?: string;
  live?: boolean;
  text: string;
};

const Markdown = memo(function Markdown({ className, live, text }: MarkdownProps) {
  return (
    <Streamdown
      className={cn('canary-markdown', className)}
      mode={live ? 'streaming' : 'static'}
      plugins={{ code }}
    >
      {text}
    </Streamdown>
  );
});

function materializeTranscriptTurns(msgs: SyncMessage[], parts: Part[]): TranscriptTurn[] {
  const partsByMessageId = groupPartsByMessageId(parts);
  const visibleFinalRunIds = new Set<string>();

  const turns: TranscriptTurn[] = [];
  let currentTurn: TranscriptTurn | null = null;

  for (const msg of msgs.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    if (msg.role === 'user') {
      currentTurn = {
        assistants: [],
        at: msg.createdAt,
        id: `turn:${msg.id}`,
        live: false,
        user: msg,
      };

      turns.push(currentTurn);
      continue;
    }

    if (msg.role !== 'assistant') {
      continue;
    }

    const segment = assistantSegmentFromMessage(msg, partsByMessageId.get(msg.id) ?? []);

    if (!segment || !currentTurn) {
      continue;
    }

    if (msg.runId) {
      visibleFinalRunIds.add(msg.runId);
    }

    upsertAssistantSegment(currentTurn, segment);
    currentTurn.live ||= segment.live;
  }

  attachLiveRunSegments(turns, parts, visibleFinalRunIds);

  return turns;
}

function assistantSegmentFromMessage(
  msg: SyncMessage,
  partsForMessage: Part[],
): AssistantTurnSegment | null {
  const visibleParts = orderParts(partsForMessage).filter(isVisiblePart);

  if (visibleParts.length) {
    return {
      at: visibleParts[0]?.createdAt ?? msg.createdAt,
      id: transcriptAssistantSegmentId(msg),
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
    at: msg.createdAt,
    id: transcriptAssistantSegmentId(msg),
    live: false,
    msg,
    parts: [],
    text: msg.content,
  };
}

function transcriptAssistantSegmentId(msg: SyncMessage) {
  if (msg.runId) {
    return `run:${msg.runId}`;
  }

  return `msg:${msg.id}`;
}

function attachLiveRunSegments(
  turns: TranscriptTurn[],
  parts: Part[],
  visibleFinalRunIds: Set<string>,
) {
  for (const [runId, runParts] of groupLiveRunParts(parts, visibleFinalRunIds)) {
    const orderedParts = orderParts(runParts);
    const firstPart = orderedParts[0];

    if (!firstPart) {
      continue;
    }

    const owner = findOwnerTurnForSegment(turns, firstPart.createdAt);

    if (!owner) {
      continue;
    }

    upsertAssistantSegment(owner, {
      at: firstPart.createdAt,
      id: `run:${runId}`,
      live: true,
      msg: undefined,
      parts: orderedParts,
      text: '',
    });

    owner.live = true;
  }
}

function findOwnerTurnForSegment(turns: TranscriptTurn[], at: string) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];

    if (turn && turn.at <= at) {
      return turn;
    }
  }

  return turns.at(-1) ?? null;
}

function upsertAssistantSegment(turn: TranscriptTurn, segment: AssistantTurnSegment) {
  const index = turn.assistants.findIndex((assistant) => assistant.id === segment.id);

  if (index >= 0) {
    turn.assistants[index] = segment;
  } else {
    turn.assistants.push(segment);
  }

  turn.assistants.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
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

function groupLiveRunParts(parts: Part[], visibleFinalRunIds: Set<string>) {
  const grouped = new Map<string, Part[]>();

  for (const part of parts) {
    if (
      part.messageId ||
      !part.runId ||
      visibleFinalRunIds.has(part.runId) ||
      !isVisiblePart(part)
    ) {
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

  const data = 'data' in part ? part.data : undefined;

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
