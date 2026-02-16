# Data.TaggedError best practices

## When to use

- Use `Data.TaggedError` for lightweight typed errors with a stable `_tag`.
- Prefer it for domain errors that need tag-based matching via `Effect.catchTag`.

## Recommended patterns

- Keep error payloads small and structured (ids, reasons, context fields).
- Use tag-specific recovery handlers in pipelines.
- Reserve this pattern for runtime errors that do not require schema decoding.

## Avoid

- Throwing plain `Error` values in domain flows where typed recovery is expected.
- Adding very large payloads to error instances.

## Minimal example

```ts
import { Data, Effect } from "effect";

class SearchError extends Data.TaggedError("SearchError")<{
  reason: string;
}> {}

const program = Effect.fail(new SearchError({ reason: "empty query" })).pipe(
  Effect.catchTag("SearchError", (error) => Effect.succeed(error.reason)),
);
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Data.ts
- https://effect.website/docs/error-management/expected-errors
