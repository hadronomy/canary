import { env } from "@canary/env/server";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

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
