import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as WorkflowEngine from "@effect/workflow/WorkflowEngine";
import { Config, Effect, Layer } from "effect";

export const BoeWorkflowEngineLayer: Layer.Layer<WorkflowEngine.WorkflowEngine> =
  Layer.unwrapEffect(
    Config.all({
      mode: Config.string("BOE_WORKFLOW_ENGINE").pipe(Config.withDefault("sqlite")),
      sqlitePath: Config.string("BOE_WORKFLOW_SQLITE_PATH").pipe(
        Config.withDefault("./.canary-workflow.sqlite"),
      ),
    }).pipe(
      Effect.orDie,
      Effect.map(({ mode, sqlitePath }) => {
        if (mode === "memory") {
          return WorkflowEngine.layerMemory;
        }

        if (mode !== "sqlite") {
          return Layer.die(new Error("BOE_WORKFLOW_ENGINE must be either 'memory' or 'sqlite'"));
        }

        return ClusterWorkflowEngine.layer.pipe(
          Layer.provideMerge(SingleRunner.layer({ runnerStorage: "sql" })),
          Layer.provideMerge(SqliteClient.layer({ filename: sqlitePath })),
        ) as Layer.Layer<WorkflowEngine.WorkflowEngine>;
      }),
    ),
  );
