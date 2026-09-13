import { ORPCError } from '@orpc/server';
import { Effect, Layer, ManagedRuntime } from 'effect';

import * as Agent from '@canary/api/agent';
import * as Database from '@canary/api/database';
import * as Run from '@canary/api/runner';

export { close } from '@canary/api/shutdown';

const deps = Layer.merge(Agent.layer, Database.layer);
const layer = Run.layer.pipe(Layer.provide(deps));

function get() {
  return (globalThis.canaryRunRuntime ??= ManagedRuntime.make(layer));
}

function fault(error: unknown) {
  if (typeof error === 'object' && error && '_tag' in error) {
    if (error._tag === 'ThreadNotFound') {
      return new ORPCError('NOT_FOUND', { message: 'Thread not found.', cause: error });
    }

    if (error._tag === 'SchemaError') {
      return new ORPCError('BAD_REQUEST', { message: 'Invalid run input.', cause: error });
    }
  }

  return new ORPCError('INTERNAL_SERVER_ERROR', { cause: error });
}

export function exec<A, E>(effect: Effect.Effect<A, E, Run.Service>, signal?: AbortSignal) {
  return get().runPromise(effect.pipe(Effect.mapError(fault)), { signal });
}
