import { Context, Effect, HashMap, Layer, Option, Ref, Runtime, Schema } from "effect";

import type { Collector } from "./collector";
import { ConfigValidationError, FactoryNotFoundError, type CollectorError } from "./errors";
import { FactoryId } from "./schema";
import type { Capabilities, CollectorEntry, CollectorId } from "./schema";

type AnySchema = Schema.Schema.AnyNoContext;
type AnyCollectorFactory = CollectorFactory<AnySchema, unknown>;
type FactoryEnvironment<F extends AnyCollectorFactory> =
  F extends CollectorFactory<AnySchema, infer R> ? R : never;
type FactoryEnvironmentUnion<Factories extends ReadonlyArray<AnyCollectorFactory>> =
  FactoryEnvironment<Factories[number]>;

export type ConfigType<S extends AnySchema> = Schema.Schema.Type<S>;

export type CollectorRuntime = Omit<Collector, "id" | "factoryId" | "name" | "capabilities">;

export interface CollectorFactory<S extends AnySchema = AnySchema, R = never> {
  readonly id: FactoryId;
  readonly name: string;
  readonly description: string;
  readonly configSchema: S;
  readonly capabilities: Capabilities;
  readonly make: (params: {
    readonly collectorId: CollectorId;
    readonly name: string;
    readonly config: ConfigType<S>;
  }) => Effect.Effect<CollectorRuntime, CollectorError, R>;
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

export const defineFactory = <S extends AnySchema, R = never>(definition: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly configSchema: S;
  readonly capabilities: Capabilities;
  readonly make: CollectorFactory<S, R>["make"];
}): CollectorFactory<S, R> => ({
  ...definition,
  id: FactoryId(definition.id),
});

export interface CollectorFactoryRegistryShape {
  readonly register: <S extends AnySchema, R>(
    factory: CollectorFactory<S, R>,
  ) => Effect.Effect<void, never, R>;
  readonly get: (id: FactoryId) => Effect.Effect<FactorySummary, FactoryNotFoundError>;
  readonly list: Effect.Effect<readonly FactorySummary[]>;
  readonly validateConfig: (
    factoryId: FactoryId,
    collectorId: CollectorId,
    config: unknown,
  ) => Effect.Effect<unknown, CollectorError>;
  readonly instantiate: (entry: CollectorEntry) => Effect.Effect<Collector, CollectorError>;
}

const makeRegistryService = Effect.gen(function* () {
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

  const register = Effect.fn("CollectorFactoryRegistry.register")(
    <S extends AnySchema, R>(factory: CollectorFactory<S, R>) =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<R>();

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

        const instantiateFromEntry = (entry: CollectorEntry) =>
          decodeConfig(entry.collectorId, entry.config).pipe(
            Effect.flatMap((config) =>
              factory
                .make({
                  collectorId: entry.collectorId,
                  name: entry.name,
                  config,
                })
                .pipe(Effect.provide(runtime as Runtime.Runtime<R>)),
            ),
            Effect.map((runtimeCollector) => ({
              id: entry.collectorId,
              factoryId: factory.id,
              name: entry.name,
              capabilities: factory.capabilities,
              ...runtimeCollector,
            })),
          );

        return yield* Ref.update(
          registryRef,
          HashMap.set(factory.id, {
            id: factory.id,
            name: factory.name,
            description: factory.description,
            capabilities: factory.capabilities,
            decodeConfig,
            instantiateFromEntry,
          }),
        );
      }),
  );

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

  const instantiate = Effect.fn("CollectorFactoryRegistry.instantiate")((entry: CollectorEntry) =>
    lookup(entry.factoryId).pipe(Effect.flatMap((factory) => factory.instantiateFromEntry(entry))),
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
});

export class CollectorFactoryRegistry extends Context.Tag("@canary/CollectorFactoryRegistry")<
  CollectorFactoryRegistry,
  CollectorFactoryRegistryShape
>() {
  static readonly empty = Layer.effect(CollectorFactoryRegistry, makeRegistryService);
  static readonly Default = CollectorFactoryRegistry.empty;

  static layer<const Factories extends ReadonlyArray<AnyCollectorFactory>>(
    ...factories: Factories
  ): Layer.Layer<CollectorFactoryRegistry, never, FactoryEnvironmentUnion<Factories>> {
    const registerAll = (registry: CollectorFactoryRegistryShape) =>
      Effect.forEach(factories, (factory) => registry.register(factory), {
        discard: true,
      }) as Effect.Effect<void, never, FactoryEnvironmentUnion<Factories>>;

    return Layer.effect(
      CollectorFactoryRegistry,
      makeRegistryService.pipe(Effect.tap((registry) => registerAll(registry))),
    );
  }
}
