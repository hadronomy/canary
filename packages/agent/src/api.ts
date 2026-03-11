import type { SessionOrchestrator } from '~/orchestrator';
import type {
  AnyEventEnvelope,
  EventMap,
  SessionCommandInput,
  SessionMutationResult,
  SessionSnapshot,
  SubmitTurnInput,
  SubmitTurnResult,
} from '~/protocol';

export interface RestateAuthz<TContext = unknown> {
  readonly createSession?: (context: TContext) => Promise<void> | void;
  readonly submitTurn?: (input: SubmitTurnInput, context: TContext) => Promise<void> | void;
  readonly steer?: (input: SessionCommandInput, context: TContext) => Promise<void> | void;
  readonly followUp?: (input: SessionCommandInput, context: TContext) => Promise<void> | void;
  readonly cancel?: (input: SessionCommandInput, context: TContext) => Promise<void> | void;
  readonly closeSession?: (input: SessionCommandInput, context: TContext) => Promise<void> | void;
  readonly getSnapshot?: (input: SessionCommandInput, context: TContext) => Promise<void> | void;
  readonly getEvents?: (
    input: SessionCommandInput & { readonly offset?: number },
    context: TContext,
  ) => Promise<void> | void;
}

export interface CreateSessionApiOptions<TMap extends object = EventMap, TContext = unknown> {
  readonly orchestrator: SessionOrchestrator<TMap, TContext>;
  readonly authz?: RestateAuthz<TContext>;
}

export interface SessionApi<TMap extends object = EventMap, TContext = unknown> {
  readonly createSession: (context: TContext) => Promise<SessionMutationResult>;
  readonly submitTurn: (input: SubmitTurnInput, context: TContext) => Promise<SubmitTurnResult>;
  readonly steer: (input: SessionCommandInput, context: TContext) => Promise<SessionMutationResult>;
  readonly followUp: (
    input: SessionCommandInput,
    context: TContext,
  ) => Promise<SessionMutationResult>;
  readonly cancel: (
    input: SessionCommandInput,
    context: TContext,
  ) => Promise<SessionMutationResult>;
  readonly closeSession: (
    input: SessionCommandInput,
    context: TContext,
  ) => Promise<SessionMutationResult>;
  readonly getSnapshot: (
    input: SessionCommandInput,
    context: TContext,
  ) => Promise<SessionSnapshot<TMap>>;
  readonly getEvents: (
    input: SessionCommandInput & { readonly offset?: number },
    context: TContext,
  ) => Promise<ReadonlyArray<AnyEventEnvelope<TMap>>>;
}

export function createSessionApi<TMap extends object = EventMap, TContext = unknown>(
  options: CreateSessionApiOptions<TMap, TContext>,
): SessionApi<TMap, TContext> {
  return {
    createSession: async (context) => {
      await options.authz?.createSession?.(context);
      return options.orchestrator.createSession(context);
    },
    submitTurn: async (input, context) => {
      await options.authz?.submitTurn?.(input, context);
      return options.orchestrator.submitTurn(input, context);
    },
    steer: async (input, context) => {
      await options.authz?.steer?.(input, context);
      return options.orchestrator.steer(input, context);
    },
    followUp: async (input, context) => {
      await options.authz?.followUp?.(input, context);
      return options.orchestrator.followUp(input, context);
    },
    cancel: async (input, context) => {
      await options.authz?.cancel?.(input, context);
      return options.orchestrator.cancel(input, context);
    },
    closeSession: async (input, context) => {
      await options.authz?.closeSession?.(input, context);
      return options.orchestrator.closeSession(input, context);
    },
    getSnapshot: async (input, context) => {
      await options.authz?.getSnapshot?.(input, context);
      return options.orchestrator.getSnapshot(input, context);
    },
    getEvents: async (input, context) => {
      await options.authz?.getEvents?.(input, context);
      return options.orchestrator.getEvents(input, context);
    },
  };
}

export type CreateRestateApiOptions<
  TMap extends object = EventMap,
  TContext = unknown,
> = CreateSessionApiOptions<TMap, TContext>;

export type RestateApi<TMap extends object = EventMap, TContext = unknown> = SessionApi<
  TMap,
  TContext
>;

export const createRestateApi = createSessionApi;
