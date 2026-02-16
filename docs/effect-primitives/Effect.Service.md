# Effect.Service best practices

## When to use

- Use `Effect.Service` for tagged service definitions with built-in layer generation.
- Use it when a domain capability should be injectable and testable.

## Recommended patterns

- Keep service APIs effectful and domain-specific.
- Use `sync` for pure in-memory setup, `effect` when initialization requires effects.
- Provide services via layers at composition boundaries.

## Avoid

- Returning raw promises from service methods.
- Creating global singletons outside layer management.

## Minimal example

```ts
import { Effect } from "effect";

class ParserService extends Effect.Service<ParserService>()("ParserService", {
  sync: () => ({
    parse: (xml: string) => Effect.succeed({ length: xml.length }),
  }),
}) {}
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`
- `docs/boe-xml-parser-architecture.md`

## References

- https://effect.website/docs/requirements-management/services
- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts
