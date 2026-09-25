import { Context, Deferred, Effect, Layer, Queue, Schema, Stream } from 'effect';

import { cancel, open } from '@canary/agents';

export const Chat = Schema.Struct({
  role: Schema.Literals(['user', 'assistant', 'system', 'tool']),
  content: Schema.String,
});

const Record = Schema.Record(Schema.String, Schema.Unknown);

export const Piece = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text-start'), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal('text-delta'), id: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('text-end'), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal('reasoning-start'), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('reasoning-delta'),
    id: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal('reasoning-end'), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    id: Schema.String,
    name: Schema.String,
    data: Record,
  }),
  Schema.Struct({
    type: Schema.Literal('tool-delta'),
    id: Schema.String,
    name: Schema.NullOr(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('tool-result'),
    id: Schema.String,
    name: Schema.String,
    data: Record,
  }),
]);

export const Event = Schema.TaggedUnion({
  Piece: { piece: Piece },
  Finished: { text: Schema.String, data: Record },
  Failed: { error: Schema.String },
});

export type Chat = typeof Chat.Type;
export type Event = typeof Event.Type;

export type Input = {
  messages: readonly Chat[];
  /** OpenRouter slug of the model this run answers with. */
  model: string;
  ownerId: string;
  runId: string;
  threadId: string;
};

export class Failure extends Schema.TaggedError<Failure>()('AgentFailure', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly events: (input: Input) => Stream.Stream<Event, Failure>;
  readonly cancel: (id: string) => Effect.Effect<void, Failure>;
}

export class Service extends Context.Service<Service, Interface>()('@canary/api/Agent') {}

function reason(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return JSON.stringify(cause) ?? String(cause);
}

const stop = Effect.fn('Agent.cancel')((id: string) =>
  Effect.tryPromise({
    try: () => cancel(id),
    catch: (cause) => new Failure({ operation: 'cancel', cause }),
  }),
);

function events(input: Input, active: Map<string, Deferred.Deferred<void>>) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Event>();
      const done = yield* Deferred.make<void>();
      active.set(input.runId, done);
      yield* Effect.addFinalizer(() => Effect.sync(() => active.delete(input.runId)));
      const emit = (event: Event) => {
        if (Deferred.isDoneUnsafe(done)) return;
        if (event._tag !== 'Piece') Deferred.doneUnsafe(done, Effect.void);
        Queue.offerUnsafe(queue, event);
      };
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            open({
              ...input,
              piece: (piece) => emit({ _tag: 'Piece', piece }),
              finish: (text, data) => emit({ _tag: 'Finished', text, data }),
              fail: (error) => emit({ _tag: 'Failed', error: reason(error) }),
            }),
          catch: (cause) => new Failure({ operation: 'open', cause }),
        }),
        (handle) =>
          Effect.gen(function* () {
            const running = !Deferred.isDoneUnsafe(done);
            Deferred.doneUnsafe(done, Effect.void);

            if (running) {
              yield* stop(input.runId).pipe(
                Effect.timeout('5 seconds'),
                Effect.catchCause((cause) => Effect.logError('Agent cancellation failed.', cause)),
              );
            }

            yield* Effect.sync(handle.cleanup).pipe(
              Effect.catchCause((cause) => Effect.logError('Agent cleanup failed.', cause)),
            );
            yield* Queue.shutdown(queue);
          }),
      );

      return Stream.fromQueue(queue).pipe(Stream.takeUntil((event) => event._tag !== 'Piece'));
    }),
  );
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const active = new Map<string, Deferred.Deferred<void>>();

    return Service.of({
      events: (input) => events(input, active),
      cancel: (id) => {
        const done = active.get(id);
        if (done) Deferred.doneUnsafe(done, Effect.void);
        return stop(id);
      },
    });
  }),
);
