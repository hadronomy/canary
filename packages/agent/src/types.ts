export type * from "~/protocol";
export {
  createEventEnvelope,
  createEventEnvelopeFactory,
  defineCommand,
  defineEvent,
  defineEventRegistry,
  defineEventRegistryFromMap,
  toEventIndex,
  toIdempotencyKey,
  toMessageId,
  toSessionId,
  toToolExecutionId,
  toTurnId,
} from "~/protocol";

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TIntersection,
) => void
  ? TIntersection
  : never;

type AllUnionKeys<T> = keyof UnionToIntersection<T>;

export type MakeExclusive<TVariants extends Record<string, object>> = {
  readonly [TName in keyof TVariants]: TVariants[TName] & {
    readonly [TForbidden in Exclude<
      AllUnionKeys<TVariants[keyof TVariants]>,
      keyof TVariants[TName]
    >]?: `❌ Property '${TForbidden & string}' cannot be used alongside ${TName & string}.`;
  };
}[keyof TVariants];
