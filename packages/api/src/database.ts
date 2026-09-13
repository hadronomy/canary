import { Context, Effect, Layer, Schema } from 'effect';

import { db } from '@canary/db';

type Client = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class Failure extends Schema.TaggedError<Failure>()('DatabaseFailure', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly query: <A>(
    operation: string,
    run: (store: typeof db) => Promise<A>,
  ) => Effect.Effect<A, Failure>;
  readonly transact: <A>(
    operation: string,
    run: (client: Client) => Promise<A>,
  ) => Effect.Effect<A, Failure>;
}

export class Service extends Context.Service<Service, Interface>()('@canary/api/Database') {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new Failure({ operation, cause }),
  });
}

export const layer = Layer.effect(
  Service,
  Effect.acquireRelease(
    Effect.succeed(
      Service.of({
        query: (operation, run) => attempt(operation, () => run(db)),
        transact: (operation, run) => attempt(operation, () => db.transaction(run)),
      }),
    ),
    () =>
      Effect.tryPromise(() => db.$client.end()).pipe(
        Effect.catchCause((cause) => Effect.logError('Database shutdown failed.', cause)),
      ),
  ),
);
