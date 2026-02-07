import { DateTime, Effect, HashMap, Option, Ref } from "effect";

import { CollectionError } from "./errors";
import type {
  CollectionMode,
  CollectionCursor,
  CollectionProgress,
  CollectionRun,
  CollectionRunId,
  CollectionState,
  CollectionStats,
  CollectorId,
} from "./schema";
import {
  CollectionRun as CollectionRunModel,
  CollectionRunStatus,
  CollectionState as CollectionStateModel,
  CollectorId as CollectorIdBrand,
} from "./schema";

export interface RunSnapshot {
  readonly run: CollectionRun;
  readonly progress: Option.Option<CollectionProgress>;
}

export interface StateUpdate {
  readonly mode: CollectionMode;
  readonly documentsCollected: number;
  readonly lastDocumentDate: Option.Option<Date>;
  readonly cursor: Option.Option<{ readonly value: string }>;
}

export class CollectorStateManager extends Effect.Service<CollectorStateManager>()(
  "CollectorStateManager",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const activeRunsRef = yield* Ref.make(HashMap.empty<CollectionRunId, RunSnapshot>());
      const collectorStatesRef = yield* Ref.make(HashMap.empty<CollectorId, CollectionState>());

      const lookupRun = Effect.fn("CollectorStateManager.lookupRun")(function* (
        runId: CollectionRunId,
      ) {
        const runs = yield* Ref.get(activeRunsRef);
        return yield* HashMap.get(runs, runId).pipe(
          Option.match({
            onNone: () =>
              new CollectionError({
                collectorId: CollectorIdBrand("00000000-0000-0000-0000-000000000000"),
                runId,
                reason: `Run '${runId}' not found`,
                message: `Run '${runId}' not found`,
              }),
            onSome: Effect.succeed,
          }),
        );
      });

      const getState = Effect.fn("CollectorStateManager.getState")((collectorId: CollectorId) =>
        Ref.get(collectorStatesRef).pipe(
          Effect.map((stateMap) => HashMap.get(stateMap, collectorId)),
        ),
      );

      const updateState = Effect.fn("CollectorStateManager.updateState")(function* (
        collectorId: CollectorId,
        update: StateUpdate,
      ) {
        const now = DateTime.unsafeNow();
        const current = yield* getState(collectorId);
        const previous = Option.getOrElse(
          current,
          () =>
            new CollectionStateModel({
              collectorId,
              lastFullSync: Option.none(),
              lastIncremental: Option.none(),
              lastCursor: Option.none(),
              totalDocumentsCollected: 0,
              lastDocumentDate: Option.none(),
              metadata: {},
              updatedAt: now,
            }),
        );

        const nextCursor: Option.Option<CollectionCursor> = Option.map(update.cursor, (cursor) => ({
          value: cursor.value,
          displayLabel: Option.none(),
        }));

        const next = new CollectionStateModel({
          ...previous,
          lastFullSync: update.mode._tag === "FullSync" ? Option.some(now) : previous.lastFullSync,
          lastIncremental:
            update.mode._tag === "Incremental" ? Option.some(now) : previous.lastIncremental,
          lastCursor: nextCursor,
          totalDocumentsCollected: previous.totalDocumentsCollected + update.documentsCollected,
          updatedAt: now,
        });

        yield* Ref.update(collectorStatesRef, HashMap.set(collectorId, next));
      });

      const createRun = Effect.fn("CollectorStateManager.createRun")(function* (
        collectorId: CollectorId,
        mode: CollectionMode,
      ) {
        const runId = crypto.randomUUID() as CollectionRunId;
        const now = DateTime.unsafeNow();
        const run = new CollectionRunModel({
          runId,
          collectorId,
          mode,
          status: CollectionRunStatus.Queued(),
          createdAt: now,
          updatedAt: now,
          completedAt: Option.none(),
        });
        yield* Ref.update(activeRunsRef, HashMap.set(runId, { run, progress: Option.none() }));
        return runId;
      });

      const updateProgress = Effect.fn("CollectorStateManager.updateProgress")(function* (
        runId: CollectionRunId,
        progress: CollectionProgress,
      ) {
        const snapshot = yield* lookupRun(runId);
        const updatedRun = new CollectionRunModel({
          ...snapshot.run,
          status: CollectionRunStatus.Running({ progress }),
          updatedAt: DateTime.unsafeNow(),
        });
        yield* Ref.update(
          activeRunsRef,
          HashMap.set(runId, { run: updatedRun, progress: Option.some(progress) }),
        );
      });

      const completeRun = Effect.fn("CollectorStateManager.completeRun")(function* (
        runId: CollectionRunId,
        _stats: CollectionStats,
      ) {
        yield* lookupRun(runId);
        yield* Ref.update(activeRunsRef, HashMap.remove(runId));
      });

      const failRun = Effect.fn("CollectorStateManager.failRun")(function* (
        runId: CollectionRunId,
        _error: string,
        _progress: Option.Option<CollectionProgress>,
        _retryable: boolean,
      ) {
        yield* lookupRun(runId);
        yield* Ref.update(activeRunsRef, HashMap.remove(runId));
      });

      const cancelRun = Effect.fn("CollectorStateManager.cancelRun")(function* (
        runId: CollectionRunId,
        _reason: Option.Option<string>,
        _progress: Option.Option<CollectionProgress>,
      ) {
        yield* lookupRun(runId);
        yield* Ref.update(activeRunsRef, HashMap.remove(runId));
      });

      const getResumableRun = Effect.fn("CollectorStateManager.getResumableRun")(
        (collectorId: CollectorId) =>
          Ref.get(activeRunsRef).pipe(
            Effect.map((runs) =>
              Array.from(HashMap.values(runs)).find(
                (snapshot) => snapshot.run.collectorId === collectorId,
              ),
            ),
            Effect.map((snapshot) => Option.fromNullable(snapshot)),
          ),
      );

      const getRunSnapshot = Effect.fn("CollectorStateManager.getRunSnapshot")(
        (runId: CollectionRunId) =>
          Ref.get(activeRunsRef).pipe(Effect.map((runs) => HashMap.get(runs, runId))),
      );

      const getActiveRuns = Ref.get(activeRunsRef).pipe(
        Effect.map((runs) => Array.from(HashMap.values(runs))),
      );

      return {
        getState,
        updateState,
        createRun,
        updateProgress,
        completeRun,
        failRun,
        cancelRun,
        getResumableRun,
        getRunSnapshot,
        getActiveRuns,
      };
    }),
  },
) {}
