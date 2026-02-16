# Schedule best practices

## When to use

- Use `Schedule` to control retry and repeat policies with explicit timing semantics.
- Use it with external IO where transient failures are expected.

## Recommended patterns

- Prefer bounded policies: `Schedule.exponential(...).pipe(Schedule.intersect(Schedule.recurs(n)))`.
- Keep retry strategy close to the operation it protects.
- Tune backoff values according to service SLAs and rate limits.

## Avoid

- Unbounded retries.
- Reusing one retry policy for fundamentally different failure modes.

## Minimal example

```ts
import { Effect, Schedule } from "effect";

const retryPolicy = Schedule.exponential("100 millis").pipe(Schedule.intersect(Schedule.recurs(3)));

const guarded = Effect.tryPromise({
  try: () => fetch("https://example.com"),
  catch: (cause) => new Error(String(cause)),
}).pipe(Effect.retry(retryPolicy));
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schedule.ts
- https://effect.website/docs/scheduling/introduction
