import type { z } from 'zod/v4';

import { cache } from '#replica/manifest.generated';
import { model } from '#replica/model';

/**
 * The synchronized thread model.
 *
 * @category models
 * @since 0.0.0
 */
export const Thread = attach(model.Thread, cache.threads);

/**
 * A synchronized thread row.
 *
 * @category models
 * @since 0.0.0
 */
export type Thread = z.output<typeof Thread.schema>;

/**
 * The synchronized message model.
 *
 * @category models
 * @since 0.0.0
 */
export const Message = attach(model.Message, cache.messages);

/**
 * A synchronized message row.
 *
 * @category models
 * @since 0.0.0
 */
export type Message = z.output<typeof Message.schema>;

/**
 * The synchronized run model.
 *
 * @category models
 * @since 0.0.0
 */
export const Run = attach(model.Run, cache.runs);

/**
 * A synchronized run row.
 *
 * @category models
 * @since 0.0.0
 */
export type Run = z.output<typeof Run.schema>;

/**
 * The synchronized event model.
 *
 * @category models
 * @since 0.0.0
 */
export const Event = attach(model.Event, cache.events);

/**
 * A synchronized event row.
 *
 * @category models
 * @since 0.0.0
 */
export type Event = z.output<typeof Event.schema>;

/**
 * The synchronized message-part model.
 *
 * @category models
 * @since 0.0.0
 */
export const Part = attach(model.Part, cache.parts);

/**
 * A synchronized message-part row.
 *
 * @category models
 * @since 0.0.0
 */
export type Part = z.output<typeof Part.schema>;

/**
 * Every replica indexed by its URL name.
 *
 * @category models
 * @since 0.0.0
 */
export const all = register({
  threads: Thread,
  messages: Message,
  runs: Run,
  events: Event,
  parts: Part,
});

/**
 * A valid replica URL name.
 *
 * @category models
 * @since 0.0.0
 */
export type Name = keyof typeof all;

/**
 * Any replica definition.
 *
 * @category models
 * @since 0.0.0
 */
export type Any = (typeof all)[Name];

/**
 * Gets the row type carried by a replica definition.
 *
 * @category models
 * @since 0.0.0
 */
export type Row<R extends Any> = z.output<R['schema']>;

/**
 * Checks an untrusted URL segment before replica lookup.
 *
 * @category guards
 * @since 0.0.0
 */
export function has(name: string): name is Name {
  return Object.hasOwn(all, name);
}

/**
 * Gets a replica after its name has crossed the input boundary.
 *
 * @category getters
 * @since 0.0.0
 */
export function get<const N extends Name>(name: N): (typeof all)[N] {
  return all[name];
}

function attach<const Model extends object>(item: Model, cacheVersion: number) {
  return Object.freeze({ ...item, cacheVersion });
}

function register<const Replicas extends Record<string, { readonly name: string }>>(
  replicas: Replicas & {
    readonly [Name in keyof Replicas]: { readonly name: Name };
  },
) {
  return Object.freeze(replicas);
}
