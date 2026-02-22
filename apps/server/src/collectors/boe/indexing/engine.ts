import { ClusterWorkflowEngine, SingleRunner } from "@effect/cluster";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import * as WorkflowEngine from "@effect/workflow/WorkflowEngine";
import { Layer } from "effect";

export const BoeWorkflowEngineLayer: Layer.Layer<WorkflowEngine.WorkflowEngine> = Layer.suspend(
  () => {
    const mode = Bun.env.BOE_WORKFLOW_ENGINE ?? "sqlite";
    if (mode === "memory") {
      return WorkflowEngine.layerMemory;
    }

    if (mode !== "sqlite") {
      return Layer.die(new Error("BOE_WORKFLOW_ENGINE must be either 'memory' or 'sqlite'"));
    }

    const sqlitePath = Bun.env.BOE_WORKFLOW_SQLITE_PATH ?? "./.canary-workflow.sqlite";
    return ClusterWorkflowEngine.layer.pipe(
      Layer.provideMerge(SingleRunner.layer({ runnerStorage: "sql" })),
      Layer.provideMerge(SqliteClient.layer({ filename: sqlitePath })),
    ) as Layer.Layer<WorkflowEngine.WorkflowEngine>;
  },
);
