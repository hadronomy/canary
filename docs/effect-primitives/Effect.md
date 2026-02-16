# Effect best practices

## When to use

- Use `Effect` as the default abstraction for side effects, async workflows, retries, timeouts, and typed error channels.
- Use `Effect.gen` for sequential business logic that would otherwise be nested `pipe` chains.

## Recommended patterns

- Wrap throwable or promise-based APIs with `Effect.try` or `Effect.tryPromise` and map to domain errors.
- Name important operations with `Effect.fn("...")` for observability and tracing.
- Keep execution at the boundary (`Effect.runPromise` in app entrypoints), not inside business logic.
- Use `Effect.forEach` and `Effect.all` for controlled parallel composition.
- Combine resilience operators intentionally: `Effect.retry`, `Effect.timeout`, `Effect.tapError`, `Effect.catchAll`.

## Avoid

- Calling `Effect.runPromise` in service internals.
- Throwing raw exceptions from domain logic.
- Using unbounded retry policies.

## Minimal example

```ts
import { Effect, Schedule } from "effect";

const fetchWithRetry = Effect.fn("Search.fetch")(function* () {
  return yield* Effect.tryPromise({
    try: () => fetch("https://example.com").then((r) => r.json()),
    catch: (cause) => new Error(`Request failed: ${String(cause)}`),
  }).pipe(
    Effect.timeout("5 seconds"),
    Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.intersect(Schedule.recurs(3)))),
  );
});
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`
- `docs/boe-xml-parser-architecture.md`
- `docs/node-extraction-guide.md`
- `docs/boe-xml-inconsistencies-study.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts
- https://effect.website/docs/getting-started/introduction
