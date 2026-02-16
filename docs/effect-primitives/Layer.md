# Layer best practices

## When to use

- Use `Layer` for service wiring, dependency graphs, and resource lifecycle management.
- Use it when a service needs startup/shutdown semantics or other services.

## Recommended patterns

- Prefer `Effect.Service` plus `.Default` layers for standard service construction.
- Use `Layer.scoped` with acquire/release resources.
- Compose layers with `Layer.mergeAll` and provide once near the application boundary.
- Keep layers focused: one domain concern per layer.

## Avoid

- Manually instantiating services throughout the codebase.
- Hiding expensive resource allocation inside plain constructors.
- Deeply nested `provide` chains when composition can be flattened.

## Minimal example

```ts
import { Effect, Layer } from "effect";

class SearchService extends Effect.Service<SearchService>()("SearchService", {
  sync: () => ({
    search: (q: string) => Effect.succeed([q]),
  }),
}) {}

const program = Effect.gen(function* () {
  const search = yield* SearchService;
  return yield* search.search("effect");
}).pipe(Effect.provide(SearchService.Default));
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Layer.ts
- https://effect.website/docs/requirements-management/layers
