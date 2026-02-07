import { DateTime, Effect, Option } from "effect";

import { CollectorNotFoundError } from "./errors";
import type {
  CollectorId,
  FactoryId,
  CollectorEntry,
  CollectionState,
  CollectionMode,
} from "./schema";

export type CollectorFilter =
  | { readonly _tag: "ById"; readonly id: CollectorId }
  | { readonly _tag: "ByFactory"; readonly factoryId: FactoryId }
  | { readonly _tag: "Enabled" }
  | { readonly _tag: "All" };

export const CollectorFilter = {
  byId: (id: CollectorId): CollectorFilter => ({ _tag: "ById", id }),
  byFactory: (factoryId: FactoryId): CollectorFilter => ({ _tag: "ByFactory", factoryId }),
  enabled: (): CollectorFilter => ({ _tag: "Enabled" }),
  all: (): CollectorFilter => ({ _tag: "All" }),
};

export interface CollectorCreate {
  readonly factoryId: FactoryId;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly schedule: string;
  readonly defaultMode: CollectionMode;
  readonly config: unknown;
}

export interface CollectorPatch {
  readonly name?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly schedule?: string;
  readonly defaultMode?: CollectionMode;
  readonly config?: unknown;
  readonly state?: CollectionState;
}

export interface CollectorRepositoryShape {
  readonly findOne: (id: CollectorId) => Effect.Effect<CollectorEntry, CollectorNotFoundError>;
  readonly findMany: (filter: CollectorFilter) => Effect.Effect<readonly CollectorEntry[]>;
  readonly create: (entry: CollectorCreate) => Effect.Effect<CollectorEntry>;
  readonly update: (
    id: CollectorId,
    patch: CollectorPatch,
  ) => Effect.Effect<CollectorEntry, CollectorNotFoundError>;
  readonly remove: (id: CollectorId) => Effect.Effect<void>;
}

export class CollectorRepository extends Effect.Service<CollectorRepository>()(
  "CollectorRepository",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const collectors = new Map<string, CollectorEntry>();

      return {
        findOne: (id: CollectorId) =>
          Effect.gen(function* () {
            const entry = collectors.get(id);
            if (!entry) {
              return yield* new CollectorNotFoundError({
                collectorId: id,
                message: `Collector '${id}' not found`,
              });
            }
            return entry;
          }),

        findMany: (filter: CollectorFilter) =>
          Effect.succeed(
            Array.from(collectors.values()).filter((entry) => {
              switch (filter._tag) {
                case "ById":
                  return entry.collectorId === filter.id;
                case "ByFactory":
                  return entry.factoryId === filter.factoryId;
                case "Enabled":
                  return entry.enabled;
                case "All":
                default:
                  return true;
              }
            }),
          ),

        create: (entry: CollectorCreate) =>
          Effect.gen(function* () {
            const id = crypto.randomUUID() as CollectorId;
            const now = DateTime.unsafeNow();
            const newEntry = {
              collectorId: id,
              factoryId: entry.factoryId,
              name: entry.name,
              description: Option.fromNullable(entry.description),
              enabled: entry.enabled,
              schedule: entry.schedule,
              defaultMode: entry.defaultMode,
              config: entry.config,
              state: Option.none<CollectionState>(),
              createdAt: now,
              updatedAt: now,
            } satisfies CollectorEntry;
            collectors.set(id, newEntry);
            return newEntry;
          }),

        update: (id: CollectorId, patch: CollectorPatch) =>
          Effect.gen(function* () {
            const entry = collectors.get(id);
            if (!entry) {
              return yield* new CollectorNotFoundError({
                collectorId: id,
                message: `Collector '${id}' not found`,
              });
            }
            const updated = {
              ...entry,
              ...(patch.name !== undefined && { name: patch.name }),
              ...(patch.description !== undefined && {
                description: Option.fromNullable(patch.description),
              }),
              ...(patch.enabled !== undefined && { enabled: patch.enabled }),
              ...(patch.schedule !== undefined && { schedule: patch.schedule }),
              ...(patch.defaultMode !== undefined && { defaultMode: patch.defaultMode }),
              ...(patch.config !== undefined && { config: patch.config }),
              ...(patch.state !== undefined && { state: Option.some(patch.state) }),
              updatedAt: DateTime.unsafeNow(),
            } satisfies CollectorEntry;
            collectors.set(id, updated);
            return updated;
          }),

        remove: (id: CollectorId) =>
          Effect.sync(() => {
            collectors.delete(id);
          }),
      };
    }),
  },
) {}
