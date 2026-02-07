import { Effect, Stream } from "effect";
import type { Option } from "effect/Option";

import type { CollectorError } from "./errors";
import type {
  CollectorId,
  FactoryId,
  CollectionRunId,
  CollectionBatch,
  CollectionMode,
  Capabilities,
} from "./schema";

export type HealthStatus =
  | { readonly status: "healthy"; readonly checkedAt: Date }
  | { readonly status: "degraded"; readonly message: string; readonly checkedAt: Date }
  | { readonly status: "unhealthy"; readonly message: string; readonly checkedAt: Date };

export interface Collector {
  readonly id: CollectorId;
  readonly factoryId: FactoryId;
  readonly name: string;
  readonly capabilities: Capabilities;

  readonly collect: (
    mode: CollectionMode,
    runId: CollectionRunId,
  ) => Stream.Stream<CollectionBatch, CollectorError>;

  readonly validate: Effect.Effect<void, CollectorError>;

  readonly detectChanges: (since: Date) => Effect.Effect<boolean, CollectorError>;

  readonly estimateTotal: (mode: CollectionMode) => Effect.Effect<Option<number>, CollectorError>;

  readonly healthCheck: Effect.Effect<HealthStatus, never>;
}

export type ModeIntent = "auto" | "forceFullSync" | "forceIncremental";
