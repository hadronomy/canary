import { ArrowLineDownIcon as LatestIcon } from '@phosphor-icons/react';
import { code } from '@streamdown/code';
import { useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useActorRef, useSelector } from '@xstate/react';
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Streamdown } from 'streamdown';
import { VList, type VListHandle } from 'virtua';
import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import type { Part, Message as SyncMessage } from '@canary/sync';

import { AgentPrompt } from '~/components/agent-prompt';
import { shellRoutes } from '~/components/shell/routes';
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

type MeasuredViewportEventFields = {
  atLatest: boolean;
  canFollowBottom?: boolean;
  retireTail?: boolean;
};

type TranscriptScrollMachineEvent =
  | {
      type: 'RESET';
    }
  | {
      atLatest: boolean;
      busy: boolean;
      streamJustSettled: boolean;
      type: 'LAYOUT_CHANGED';
    }
  | {
      atLatest: boolean;
      latestTurnId: string;
      type: 'THREAD_READY';
    }
  | {
      atLatest: boolean;
      latestTurnId: string;
      type: 'LATEST_TURN_CHANGED';
    }
  | {
      atLatest: boolean;
      latestTurnId: string;
      type: 'JUMP_TO_LATEST';
    }
  | {
      atLatest: boolean;
      latestTurnId: string;
      type: 'LOCAL_APPEND_CANCELLED';
    }
  | {
      atLatest: boolean;
      type: 'LOCAL_APPEND_PREPARED';
    }
  | {
      atLatest: boolean;
      retireTail?: boolean;
      type: 'USER_SCROLL_INTENT';
    }
  | (MeasuredViewportEventFields & {
      type: 'USER_SCROLL_POSITION_CHANGED';
    })
  | (MeasuredViewportEventFields & {
      type: 'SCROLL_POSITION_CHANGED';
    })
  | (MeasuredViewportEventFields & {
      type: 'SCROLL_ENDED';
    })
  | (MeasuredViewportEventFields & {
      type: 'PASSIVE_VIEWPORT_PROBED';
    })
  | {
      atLatest: boolean;
      type: 'LANDING_DONE';
    }
  | {
      atLatest?: boolean;
      type: 'FOLLOW_BOTTOM';
    }
  | {
      canRetire: boolean;
      type: 'TAIL_RETIREMENT_CHECKED';
    };

type TranscriptScrollSnapshot = {
  atLatest: boolean;
  mode: TranscriptScrollMode;
  showJumpToLatest: boolean;
};

type TranscriptRuntimeCommands = {
  cancelPreparedLocalUserAppend: () => void;
  prepareForLocalUserAppend: () => void;
};

type TranscriptRuntimeBridge = TranscriptRuntimeCommands & {
  registerCommands: (commands: TranscriptRuntimeCommands) => () => void;
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

const transcriptRuntimeCommandsFallback = {
  cancelPreparedLocalUserAppend() {},
  prepareForLocalUserAppend() {},
} satisfies TranscriptRuntimeCommands;

const TranscriptRuntimeBridgeContext = createContext<TranscriptRuntimeBridge | null>(null);

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
  guards: {
    canFollowBottom: ({ event }) => 'canFollowBottom' in event && event.canFollowBottom === true,

    canRetireTail: ({ event }) => event.type === 'TAIL_RETIREMENT_CHECKED' && event.canRetire,

    isAtLatest: ({ event }) => 'atLatest' in event && event.atLatest === true,

    isAwayFromLatest: ({ event }) => 'atLatest' in event && event.atLatest === false,

    streamJustSettledNearLatest: ({ event }) =>
      event.type === 'LAYOUT_CHANGED' && event.streamJustSettled && event.atLatest,
  },
  actions: {
    enterFreeFromMeasuredEvent: assign(({ context, event }) => {
      if (!('atLatest' in event)) {
        return {};
      }

      return {
        atLatest: event.atLatest,
        hasLeftLatest: context.hasLeftLatest || !event.atLatest,
        tailRetirement:
          'retireTail' in event && event.retireTail ? 'pending' : context.tailRetirement,
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
      if (!('atLatest' in event)) {
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
  initial: 'ready',
  context: () => ({ ...initialTranscriptScrollContext }),
  on: {
    RESET: {
      target: '#following-bottom',
      actions: 'resetContext',
    },

    LAYOUT_CHANGED: {
      actions: 'setLayoutBusy',
    },
  },
  states: {
    ready: {
      id: 'ready',
      initial: 'tracking',
      on: {
        THREAD_READY: {
          target: '#landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromRequiredEvent', 'resetFreeContext'],
        },

        JUMP_TO_LATEST: {
          target: '#landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromRequiredEvent', 'resetFreeContext'],
        },

        LOCAL_APPEND_CANCELLED: {
          target: '#landing-to-latest',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromRequiredEvent', 'resetFreeContext'],
        },

        LATEST_TURN_CHANGED: {
          target: '#anchored-turn',
          actions: ['setLatestTurnIdFromEvent', 'setAtLatestFromRequiredEvent'],
        },

        LOCAL_APPEND_PREPARED: {
          target: '#pre-anchoring-next-turn',
          actions: 'setAtLatestFromRequiredEvent',
        },

        FOLLOW_BOTTOM: {
          target: '#following-bottom',
          actions: ['setAtLatestFromOptionalEvent', 'resetFreeContext'],
        },
      },
      states: {
        'landing-to-latest': {
          id: 'landing-to-latest',
          on: {
            LANDING_DONE: {
              target: '#following-bottom',
              actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
            },

            USER_SCROLL_INTENT: {
              target: '#escaping-follow-bottom',
              actions: 'setAtLatestFromRequiredEvent',
            },

            SCROLL_POSITION_CHANGED: {
              actions: 'setAtLatestFromRequiredEvent',
            },
          },
        },

        tracking: {
          id: 'tracking',
          initial: 'following-bottom',
          states: {
            'following-bottom': {
              id: 'following-bottom',
              on: {
                USER_SCROLL_INTENT: {
                  target: '#escaping-follow-bottom',
                  actions: 'setAtLatestFromRequiredEvent',
                },

                SCROLL_POSITION_CHANGED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },

                SCROLL_ENDED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },
              },
            },

            'escaping-follow-bottom': {
              id: 'escaping-follow-bottom',
              on: {
                USER_SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                SCROLL_ENDED: [
                  {
                    guard: 'isAtLatest',
                    target: '#following-bottom',
                    actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                ],

                PASSIVE_VIEWPORT_PROBED: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                LAYOUT_CHANGED: [
                  {
                    guard: 'streamJustSettledNearLatest',
                    target: '#following-bottom',
                    actions: ['setLayoutBusy', 'setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    actions: 'setLayoutBusy',
                  },
                ],
              },
            },

            free: {
              id: 'free',
              on: {
                USER_SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'canFollowBottom',
                    target: '#following-bottom',
                    actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    actions: 'setFreeViewportContext',
                  },
                ],

                SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'canFollowBottom',
                    target: '#following-bottom',
                    actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    actions: 'setFreeViewportContext',
                  },
                ],

                SCROLL_ENDED: [
                  {
                    guard: 'canFollowBottom',
                    target: '#following-bottom',
                    actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    actions: 'setFreeViewportContext',
                  },
                ],

                PASSIVE_VIEWPORT_PROBED: [
                  {
                    guard: 'canFollowBottom',
                    target: '#following-bottom',
                    actions: ['setAtLatestFromRequiredEvent', 'resetFreeContext'],
                  },
                  {
                    actions: 'setFreeViewportContext',
                  },
                ],

                TAIL_RETIREMENT_CHECKED: {
                  guard: 'canRetireTail',
                  actions: 'markTailRetired',
                },
              },
            },
          },
        },

        anchoring: {
          id: 'anchoring',
          initial: 'pre-anchoring-next-turn',
          states: {
            'pre-anchoring-next-turn': {
              id: 'pre-anchoring-next-turn',
              on: {
                USER_SCROLL_INTENT: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                USER_SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                SCROLL_POSITION_CHANGED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },

                SCROLL_ENDED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },
              },
            },

            'anchored-turn': {
              id: 'anchored-turn',
              on: {
                USER_SCROLL_INTENT: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                USER_SCROLL_POSITION_CHANGED: [
                  {
                    guard: 'isAwayFromLatest',
                    target: '#free',
                    actions: 'enterFreeFromMeasuredEvent',
                  },
                  {
                    actions: 'setAtLatestFromRequiredEvent',
                  },
                ],

                SCROLL_POSITION_CHANGED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },

                SCROLL_ENDED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },

                PASSIVE_VIEWPORT_PROBED: {
                  actions: 'setAtLatestFromRequiredEvent',
                },
              },
            },
          },
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

  return <ThreadContent ownerId={ctx.user.id} threadId={params.threadId} />;
}

type ThreadContentProps = {
  ownerId: string;
  threadId: string;
};

function ThreadContent({ ownerId, threadId }: ThreadContentProps) {
  return (
    <TranscriptRuntimeBridgeProvider>
      <ThreadWorkspace ownerId={ownerId} threadId={threadId} />
    </TranscriptRuntimeBridgeProvider>
  );
}

type ThreadWorkspaceProps = {
  ownerId: string;
  threadId: string;
};

function ThreadWorkspace({ ownerId, threadId }: ThreadWorkspaceProps) {
  const rosterCollection = useMemo(() => roster(ownerId), [ownerId]);
  const activeRunsCollection = useMemo(() => active(ownerId, threadId), [ownerId, threadId]);
  const transcriptCollection = useMemo(() => transcript(ownerId, threadId), [ownerId, threadId]);

  const rosterQuery = useLiveQuery(rosterCollection);
  const activeRunsQuery = useLiveQuery(activeRunsCollection);
  const transcriptQuery = useLiveQuery(transcriptCollection);

  const thread = rosterQuery.data.find((row) => row.id === threadId);
  const threadGone = rosterQuery.isReady && !thread;
  const running = activeRunsQuery.data.length > 0;
  const activeRunId = activeRunsQuery.data[0]?.id ?? null;

  const pristine = !transcriptQuery.data.some(
    (msg) => msg.threadId === threadId && msg.role === 'user',
  );

  if (threadGone) {
    return <Navigate to="/threads" replace />;
  }

  return (
    <section
      aria-labelledby="thread-title"
      className="grid h-full min-h-0 grid-rows-[auto_1fr_auto] bg-background"
      data-thread-id={threadId}
      data-thread-screen=""
    >
      <ThreadHeader threadId={threadId} title={thread?.title ?? 'Thread'} />

      <main aria-label="Conversation" className="relative h-full min-h-0">
        <TranscriptRuntime key={threadId} ownerId={ownerId} threadId={threadId} />
      </main>

      <ThreadActions
        activeRunId={activeRunId}
        disabled={!thread}
        ownerId={ownerId}
        pristine={pristine}
        running={running}
        threadId={threadId}
      />
    </section>
  );
}

type ThreadHeaderProps = Omit<ComponentPropsWithoutRef<'header'>, 'children'> & {
  threadId: string;
  title: string;
};

function ThreadHeader({ className, threadId, title, ...props }: ThreadHeaderProps) {
  return (
    <header className={cn('border-b border-border px-4 py-3', className)} {...props}>
      <h1 id="thread-title" className="truncate text-sm font-semibold">
        {title}
      </h1>
      <p className="truncate text-[11px] text-muted-foreground">{threadId}</p>
    </header>
  );
}

type ThreadActionsProps = {
  activeRunId: string | null;
  disabled: boolean;
  ownerId: string;
  pristine: boolean;
  running: boolean;
  threadId: string;
};

function ThreadActions({
  activeRunId,
  disabled,
  ownerId,
  pristine,
  running,
  threadId,
}: ThreadActionsProps) {
  const runtime = useTranscriptRuntimeBridge();

  const currentThreadIdRef = useRef(threadId);
  const draftsByThreadRef = useRef(new Map<string, string>());

  currentThreadIdRef.current = threadId;

  const [draftState, setDraftState] = useState(() => ({
    threadId,
    value: '',
  }));

  const [sendErrorState, setSendErrorState] = useState<{
    message: string | null;
    threadId: string;
  }>(() => ({
    message: null,
    threadId,
  }));

  const draft =
    draftState.threadId === threadId
      ? draftState.value
      : (draftsByThreadRef.current.get(threadId) ?? '');

  const sendError = sendErrorState.threadId === threadId ? sendErrorState.message : null;

  const writeDraft = useCallback((targetThreadId: string, value: string) => {
    if (value) {
      draftsByThreadRef.current.set(targetThreadId, value);
    } else {
      draftsByThreadRef.current.delete(targetThreadId);
    }

    if (currentThreadIdRef.current === targetThreadId) {
      setDraftState({
        threadId: targetThreadId,
        value,
      });
    }
  }, []);

  const writeSendError = useCallback((targetThreadId: string, message: string | null) => {
    if (currentThreadIdRef.current === targetThreadId) {
      setSendErrorState({
        message,
        threadId: targetThreadId,
      });
    }
  }, []);

  const submitUserMessage = useCallback(
    async (body: string) => {
      const content = body.trim();

      if (disabled || !content) {
        return;
      }

      const submittedThreadId = threadId;

      runtime.prepareForLocalUserAppend();

      const now = new Date().toISOString();

      const transaction = messages(ownerId).insert({
        id: crypto.randomUUID(),
        threadId: submittedThreadId,
        ownerId,
        runId: null,
        role: 'user',
        content,
        metadata: null,
        createdAt: now,
        updatedAt: now,
      });

      writeDraft(submittedThreadId, '');
      writeSendError(submittedThreadId, null);

      await transaction.isPersisted.promise.catch((cause: unknown) => {
        runtime.cancelPreparedLocalUserAppend();

        if (!draftsByThreadRef.current.get(submittedThreadId)) {
          writeDraft(submittedThreadId, content);
        }

        writeSendError(
          submittedThreadId,
          cause instanceof Error ? cause.message : 'Message send failed.',
        );

        throw cause;
      });
    },
    [disabled, ownerId, runtime, threadId, writeDraft, writeSendError],
  );

  const cancelActiveRun = useCallback(async () => {
    if (!activeRunId) {
      return;
    }

    await client.run.cancel({ id: activeRunId });
  }, [activeRunId]);

  return (
    <AgentPrompt
      disabled={disabled}
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
      onValue={(value) => {
        writeDraft(threadId, value);
      }}
    />
  );
}

type TranscriptRuntimeBridgeProviderProps = {
  children: ReactNode;
};

function TranscriptRuntimeBridgeProvider({ children }: TranscriptRuntimeBridgeProviderProps) {
  const commandsRef = useRef<TranscriptRuntimeCommands>(transcriptRuntimeCommandsFallback);

  const bridge = useMemo<TranscriptRuntimeBridge>(
    () => ({
      cancelPreparedLocalUserAppend() {
        commandsRef.current.cancelPreparedLocalUserAppend();
      },

      prepareForLocalUserAppend() {
        commandsRef.current.prepareForLocalUserAppend();
      },

      registerCommands(commands) {
        commandsRef.current = commands;

        return () => {
          if (commandsRef.current === commands) {
            commandsRef.current = transcriptRuntimeCommandsFallback;
          }
        };
      },
    }),
    [],
  );

  return (
    <TranscriptRuntimeBridgeContext.Provider value={bridge}>
      {children}
    </TranscriptRuntimeBridgeContext.Provider>
  );
}

function useTranscriptRuntimeBridge() {
  const bridge = useContext(TranscriptRuntimeBridgeContext);

  if (!bridge) {
    throw new Error(
      'useTranscriptRuntimeBridge must be used inside TranscriptRuntimeBridgeProvider.',
    );
  }

  return bridge;
}

type TranscriptRuntimeProps = {
  ownerId: string;
  threadId: string;
};

function TranscriptRuntime({ ownerId, threadId }: TranscriptRuntimeProps) {
  const runtimeBridge = useTranscriptRuntimeBridge();
  const scrollActor = useTranscriptScrollActor();

  useLayoutEffect(() => {
    const commands = {
      cancelPreparedLocalUserAppend: scrollActor.cancelPreparedLocalUserAppend,
      prepareForLocalUserAppend: scrollActor.prepareForLocalUserAppend,
    } satisfies TranscriptRuntimeCommands;

    return runtimeBridge.registerCommands(commands);
  }, [runtimeBridge, scrollActor]);

  return <TranscriptShell ownerId={ownerId} scrollActor={scrollActor} threadId={threadId} />;
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

  const snapshot = useSelector(
    scrollActor.actorRef,
    selectTranscriptScrollSnapshot,
    compareTranscriptScrollSnapshot,
  );

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

function transcriptScrollModeFromSnapshot(
  snapshot: TranscriptScrollMachineSnapshot,
): TranscriptScrollMode {
  if (snapshot.matches({ ready: 'landing-to-latest' })) {
    return 'landing-to-latest';
  }

  if (snapshot.matches({ ready: { tracking: 'following-bottom' } })) {
    return 'following-bottom';
  }

  if (snapshot.matches({ ready: { tracking: 'escaping-follow-bottom' } })) {
    return 'escaping-follow-bottom';
  }

  if (snapshot.matches({ ready: { tracking: 'free' } })) {
    return 'free';
  }

  if (snapshot.matches({ ready: { anchoring: 'pre-anchoring-next-turn' } })) {
    return 'pre-anchoring-next-turn';
  }

  if (snapshot.matches({ ready: { anchoring: 'anchored-turn' } })) {
    return 'anchored-turn';
  }

  return 'following-bottom';
}

function selectTranscriptScrollSnapshot(
  snapshot: TranscriptScrollMachineSnapshot,
): TranscriptScrollSnapshot {
  const mode = transcriptScrollModeFromSnapshot(snapshot);
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

function compareTranscriptScrollSnapshot(
  previous: TranscriptScrollSnapshot,
  next: TranscriptScrollSnapshot,
) {
  return (
    previous.atLatest === next.atLatest &&
    previous.mode === next.mode &&
    previous.showJumpToLatest === next.showJumpToLatest
  );
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
  const actorRef = useActorRef(transcriptScrollMachine);

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
    return transcriptScrollModeFromSnapshot(actorRef.getSnapshot());
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

  function canFollowBottomFromViewport(atLatest: boolean) {
    const context = currentContext();

    return Boolean(
      environment &&
      currentMode() === 'free' &&
      atLatest &&
      context.hasLeftLatest &&
      environment.tailSpacerHeightRef.current <= TRANSCRIPT_END_BREATHING_ROOM,
    );
  }

  function measuredViewportFields(atLatest = isNearLatest()): MeasuredViewportEventFields {
    return {
      atLatest,
      canFollowBottom: canFollowBottomFromViewport(atLatest),
    };
  }

  function sendScrollPositionChanged(atLatest = isNearLatest()) {
    send({
      ...measuredViewportFields(atLatest),
      type: 'SCROLL_POSITION_CHANGED',
    });
  }

  function sendUserScrollPositionChanged(atLatest = isNearLatest()) {
    const mode = currentMode();

    send({
      ...measuredViewportFields(atLatest),
      retireTail: mode === 'anchored-turn' || mode === 'pre-anchoring-next-turn',
      type: 'USER_SCROLL_POSITION_CHANGED',
    });
  }

  function sendScrollEnded(atLatest = isNearLatest()) {
    send({
      ...measuredViewportFields(atLatest),
      type: 'SCROLL_ENDED',
    });
  }

  function sendPassiveViewportProbe(atLatest = isNearLatest()) {
    send({
      ...measuredViewportFields(atLatest),
      type: 'PASSIVE_VIEWPORT_PROBED',
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

    sendScrollPositionChanged();
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

    sendScrollPositionChanged();
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

        sendScrollPositionChanged();
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

  function scheduleTailRetirementCheck() {
    if (!environment || tailRetirementFrame !== null) {
      return;
    }

    tailRetirementFrame = window.requestAnimationFrame(() => {
      tailRetirementFrame = null;

      const canRetire = canRetireTailSpacerNow();

      if (!canRetire || !environment) {
        return;
      }

      environment.setTailSpacerHeight(TRANSCRIPT_END_BREATHING_ROOM);

      send({
        canRetire: true,
        type: 'TAIL_RETIREMENT_CHECKED',
      });
    });
  }

  function maybeScheduleTailRetirementCheck() {
    if (currentMode() !== 'free' || isNearLatest()) {
      return;
    }

    scheduleTailRetirementCheck();
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

    sendPassiveViewportProbe();
    maybeScheduleTailRetirementCheck();
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

  function enterFollowingBottom(atLatest?: boolean) {
    cancelPassiveViewportProbe();
    cancelTailRetirement();
    environment?.resetTailSpacerToEndRoom();

    send({
      atLatest,
      type: 'FOLLOW_BOTTOM',
    });
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
        type: 'LOCAL_APPEND_CANCELLED',
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
      const atLatest = isNearLatest();

      if (userScrollIntent) {
        userScrollIntent = false;
        cancelProgrammaticScrollAuthority();
        sendUserScrollPositionChanged(atLatest);
        maybeScheduleTailRetirementCheck();
        return;
      }

      sendScrollPositionChanged(atLatest);

      if (!programmaticScroll) {
        maybeScheduleTailRetirementCheck();
      }
    },

    handleScrollEnd() {
      cancelProgrammaticScrollAuthority();
      sendScrollEnded();
      maybeScheduleTailRetirementCheck();
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
        type: 'JUMP_TO_LATEST',
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

      send({
        atLatest: isNearLatest(),
        retireTail: mode === 'anchored-turn' || mode === 'pre-anchoring-next-turn',
        type: 'USER_SCROLL_INTENT',
      });
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
        type: 'LOCAL_APPEND_PREPARED',
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
          type: 'THREAD_READY',
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
          type: 'LATEST_TURN_CHANGED',
        });

        anchorLatestTurn({
          allowSpacerShrink: true,
          immediate: shouldAnchorImmediately,
        });
      }
    },

    syncTranscriptLayout({ busy }) {
      const context = currentContext();
      const streamJustSettled = context.layoutBusy && !busy;

      send({
        atLatest: isNearLatest(),
        busy,
        streamJustSettled,
        type: 'LAYOUT_CHANGED',
      });

      const mode = currentMode();

      if (mode === 'following-bottom') {
        cancelPassiveViewportProbe();
        pinToLatestNow();
        settlePinnedToLatest();
        return;
      }

      if (mode === 'landing-to-latest') {
        return;
      }

      if (mode === 'free') {
        schedulePassiveViewportProbe();
        maybeScheduleTailRetirementCheck();
        return;
      }

      if (mode === 'anchored-turn' || mode === 'escaping-follow-bottom') {
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
          'grid size-10 place-items-center rounded-full border border-border',
          'bg-background/90 text-foreground shadow-sm backdrop-blur',
          'transition duration-200 ease-out',
          'hover:bg-popover hover:shadow-md',
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
        <Bubble align="end" className="max-w-none" variant="secondary">
          <BubbleContent>
            <Markdown text={msg.content} />
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
      className="flow-root min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/80 p-3 text-xs shadow-surface-1"
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
      className="my-2 flow-root min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/85 text-xs shadow-surface-2"
      defaultOpen={running}
      forceOpen={running}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-card px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <span className="min-w-0 truncate font-mono text-xs font-semibold">
          {structuredPartTitle(part)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{part.status}</span>
      </summary>

      {body ? (
        <pre className="m-0 max-h-80 max-w-full overflow-auto whitespace-pre-wrap border-t border-border bg-popover px-3 py-2.5 font-mono text-[12px] leading-5 wrap-anywhere">
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
