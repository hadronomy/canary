# @canary/agent examples

This directory contains a Restate-backed example split into worker and edge server:

- `restate-worker.ts` - Restate service worker (`agent-orchestrator`) hosting harness orchestration
- `server.ts` - edge HTTP proxy exposing `/run`, `/submit`, `/result`, `/continue`, `/events`, `/steer`, `/follow-up`, `/cancel`
- `client.ts` - session-handle client using `client.session(sessionId, agentKey)`
- `shared.ts` - shared typed input/output/context contracts for `supportAgent` + public contracts

## Notes

- `session.events()` now injects `sessionId` automatically into the configured `eventsUrl`.
- `run` remains synchronous for compatibility; `submit` + `result` is the first-class async path.
- `restate-worker.ts` uses `loginOpenAICodex(...)` and persists OAuth credentials in `examples/auth.json`.
- Set `RESTATE_INGRESS_URL` (default: `http://127.0.0.1:8080`) for the edge server.
- Set `RESTATE_WORKER_PORT` (default: `9080`) for the worker endpoint.
- Edge auth uses `Authorization: Bearer <token>` where token is `EXAMPLE_AGENT_API_TOKEN` (default: `dev-token`).

## Run (local)

1. Start Restate server locally (ingress at `:8080`).
2. Start worker:
   - `bun examples/restate-worker.ts`
3. Start edge server:
   - `bun examples/server.ts`
4. Run client:
   - `bun examples/client.ts`
