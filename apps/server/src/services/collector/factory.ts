import { Effect, HashMap, Option, Ref, Schema } from "effect";

import type { Collector } from "./collector";
import { ConfigValidationError, FactoryNotFoundError, type CollectorError } from "./errors";
import { FactoryId } from "./schema";
import type { Capabilities, CollectorEntry, CollectorId } from "./schema";

type AnySchema = Schema.Schema.AnyNoContext;

export type ConfigType<S extends AnySchema> = Schema.Schema.Type<S>;

export type CollectorRuntime = Omit<Collector, "id" | "factoryId" | "name" | "capabilities">;

export interface CollectorFactory<S extends AnySchema = AnySchema> {
  readonly id: FactoryId;
  readonly name: string;
  readonly description: string;
  readonly configSchema: S;
  readonly capabilities: Capabilities;
  readonly make: (params: {
    readonly collectorId: CollectorId;
    readonly name: string;
    readonly config: ConfigType<S>;
  }) => Effect.Effect<CollectorRuntime, CollectorError>;
}

export interface FactorySummary {
  readonly id: FactoryId;
  readonly name: string;
  readonly description: string;
  readonly capabilities: Capabilities;
}

interface RegisteredFactory extends FactorySummary {
  readonly decodeConfig: (
    collectorId: CollectorId,
    config: unknown,
  ) => Effect.Effect<AnySchema["Type"], ConfigValidationError>;
  readonly instantiateFromEntry: (
    entry: CollectorEntry,
  ) => Effect.Effect<Collector, CollectorError>;
}

export const defineFactory = <S extends AnySchema>(definition: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly configSchema: S;
  readonly capabilities: Capabilities;
  readonly make: CollectorFactory<S>["make"];
}): CollectorFactory<S> => ({
  ...definition,
  id: FactoryId(definition.id),
});

export interface CollectorFactoryRegistryShape {
  readonly register: <S extends AnySchema>(factory: CollectorFactory<S>) => Effect.Effect<void>;
  readonly get: (id: FactoryId) => Effect.Effect<FactorySummary, FactoryNotFoundError>;
  readonly list: Effect.Effect<readonly FactorySummary[]>;
  readonly validateConfig: (
    factoryId: FactoryId,
    collectorId: CollectorId,
    config: unknown,
  ) => Effect.Effect<unknown, CollectorError>;
  readonly instantiate: (entry: CollectorEntry) => Effect.Effect<Collector, CollectorError>;
}

export class CollectorFactoryRegistry extends Effect.Service<CollectorFactoryRegistry>()(
  "CollectorFactoryRegistry",
  {
    accessors: false,
    effect: Effect.gen(function* () {
      const registryRef = yield* Ref.make(HashMap.empty<FactoryId, RegisteredFactory>());

      const lookup = Effect.fn("CollectorFactoryRegistry.lookup")(function* (id: FactoryId) {
        const registry = yield* Ref.get(registryRef);
        return yield* HashMap.get(registry, id).pipe(
          Option.match({
            onNone: () =>
              Effect.fail(
                new FactoryNotFoundError({
                  factoryId: id,
                  message: `Factory '${id}' not registered`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        );
      });

      const register = Effect.fn("CollectorFactoryRegistry.register")(<S extends AnySchema>(
        factory: CollectorFactory<S>,
      ) => {
        const decodeConfig = (collectorId: CollectorId, config: unknown) =>
          Schema.decodeUnknown(factory.configSchema)(config).pipe(
            Effect.mapError(
              (parseError) =>
                new ConfigValidationError({
                  collectorId,
                  issues: [String(parseError)],
                  message: `Config validation failed for '${collectorId}'`,
                }),
            ),
          );

        return Ref.update(
          registryRef,
          HashMap.set(factory.id, {
            id: factory.id,
            name: factory.name,
            description: factory.description,
            capabilities: factory.capabilities,
            decodeConfig,
            instantiateFromEntry: (entry: CollectorEntry) =>
              decodeConfig(entry.collectorId, entry.config).pipe(
                Effect.flatMap((config) =>
                  factory.make({
                    collectorId: entry.collectorId,
                    name: entry.name,
                    config,
                  }),
                ),
                Effect.map((runtime) => ({
                  id: entry.collectorId,
                  factoryId: factory.id,
                  name: entry.name,
                  capabilities: factory.capabilities,
                  ...runtime,
                })),
              ),
          }),
        );
      });

      const get = Effect.fn("CollectorFactoryRegistry.get")((id: FactoryId) =>
        lookup(id).pipe(
          Effect.map(({ instantiateFromEntry: _, decodeConfig: __, ...summary }) => summary),
        ),
      );

      const list = Ref.get(registryRef).pipe(
        Effect.map((registry) =>
          Array.from(HashMap.values(registry)).map(
            ({ instantiateFromEntry: _, decodeConfig: __, ...summary }) => summary,
          ),
        ),
      );

      const instantiate = Effect.fn("CollectorFactoryRegistry.instantiate")(
        (entry: CollectorEntry) =>
          lookup(entry.factoryId).pipe(
            Effect.flatMap((factory) => factory.instantiateFromEntry(entry)),
          ),
      );

      const validateConfig = Effect.fn("CollectorFactoryRegistry.validateConfig")(
        (factoryId: FactoryId, collectorId: CollectorId, config: unknown) =>
          lookup(factoryId).pipe(
            Effect.flatMap((factory) => factory.decodeConfig(collectorId, config)),
          ),
      );

      return {
        register,
        get,
        list,
        validateConfig,
        instantiate,
      };
    }),
  },
) {}
