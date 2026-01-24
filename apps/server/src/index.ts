import { env } from "@canary/env/server";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { cors } from "@elysiajs/cors";
import { Effect, Layer } from "effect";
import { Elysia } from "elysia";
import { runSeederCli, SeederCliLiveLayer } from "./cli/seeder.js";

if (process.argv[2] === "seeder") {
  const cliLayer = Layer.merge(SeederCliLiveLayer, BunContext.layer);
  runSeederCli(process.argv).pipe(Effect.provide(cliLayer), BunRuntime.runMain);
} else {
  // @ts-ignore 6133
  // oxlint-disable-next-line no-unused-vars
  const app = new Elysia()
    .use(
      cors({
        origin: env.CORS_ORIGIN,
        methods: ["GET", "POST", "OPTIONS"],
      }),
    )
    .get("/", () => "OK")
    .listen(3000, () => {
      console.log("Server is running on http://localhost:3000");
    });
}

export { SeederDaemon } from "./workflows/seeder-daemon.js";
