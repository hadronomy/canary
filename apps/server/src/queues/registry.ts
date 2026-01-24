import type { Schema } from "effect";

export type QueueDescriptor<Name extends string, S extends Schema.Schema.AnyNoContext> = {
  readonly name: Name;
  readonly schema: S;
};

export const defineQueue = <Name extends string, S extends Schema.Schema.AnyNoContext>(
  name: Name,
  schema: S,
): QueueDescriptor<Name, S> => ({ name, schema });

export const defineQueues = <
  Queues extends Record<string, QueueDescriptor<string, Schema.Schema.AnyNoContext>>,
>(
  queues: Queues,
): Queues => queues;
