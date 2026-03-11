import type {
  AnyEventEnvelope,
  EventMap,
  SessionCommandInput,
  SessionMutationResult,
  SessionSnapshot,
  SubmitTurnInput,
  SubmitTurnResult,
} from '~/protocol';
import type { Runtime } from '~/runtime';

export interface SessionOrchestrator<TMap extends object = EventMap, TAuthContext = unknown> {
  readonly createSession: (context: TAuthContext) => Promise<SessionMutationResult>;
  readonly submitTurn: (input: SubmitTurnInput, context: TAuthContext) => Promise<SubmitTurnResult>;
  readonly steer: (
    input: SessionCommandInput,
    context: TAuthContext,
  ) => Promise<SessionMutationResult>;
  readonly followUp: (
    input: SessionCommandInput,
    context: TAuthContext,
  ) => Promise<SessionMutationResult>;
  readonly cancel: (
    input: SessionCommandInput,
    context: TAuthContext,
  ) => Promise<SessionMutationResult>;
  readonly closeSession: (
    input: SessionCommandInput,
    context: TAuthContext,
  ) => Promise<SessionMutationResult>;
  readonly getSnapshot: (
    input: SessionCommandInput,
    context: TAuthContext,
  ) => Promise<SessionSnapshot<TMap>>;
  readonly getEvents: (
    input: SessionCommandInput & { readonly offset?: number },
    context: TAuthContext,
  ) => Promise<ReadonlyArray<AnyEventEnvelope<TMap>>>;
}

export interface CreateSessionOrchestratorOptions<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object = EventMap,
  TPubsub = unknown,
  TAuthContext = unknown,
> {
  readonly runtime: TRuntime;
  readonly pubsub: TPubsub;
  readonly topicForSession: (sessionId: string) => string;
  readonly handlers: SessionOrchestrator<TMap, TAuthContext>;
}

export interface SessionOrchestratorRuntime<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object = EventMap,
  TPubsub = unknown,
  TAuthContext = unknown,
> extends SessionOrchestrator<TMap, TAuthContext> {
  readonly runtime: TRuntime;
  readonly pubsub: TPubsub;
  readonly topicForSession: (sessionId: string) => string;
}

export function createSessionOrchestrator<
  TRuntime extends Runtime<unknown, unknown, unknown, unknown, unknown>,
  TMap extends object = EventMap,
  TPubsub = unknown,
  TAuthContext = unknown,
>(
  options: CreateSessionOrchestratorOptions<TRuntime, TMap, TPubsub, TAuthContext>,
): SessionOrchestratorRuntime<TRuntime, TMap, TPubsub, TAuthContext> {
  return {
    runtime: options.runtime,
    pubsub: options.pubsub,
    topicForSession: options.topicForSession,
    createSession: options.handlers.createSession,
    submitTurn: options.handlers.submitTurn,
    steer: options.handlers.steer,
    followUp: options.handlers.followUp,
    cancel: options.handlers.cancel,
    closeSession: options.handlers.closeSession,
    getSnapshot: options.handlers.getSnapshot,
    getEvents: options.handlers.getEvents,
  };
}
