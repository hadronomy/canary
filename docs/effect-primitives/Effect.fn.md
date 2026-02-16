# Effect.fn best practices

## When to use

- Use `Effect.fn` for named operations that need trace-friendly, reusable effect constructors.
- Use it for domain actions where observability matters.

## Recommended patterns

- Give stable names (`Feature.action`) to improve logs and spans.
- Keep input/output narrow and move branching logic into the effect body.
- Pair with `Effect.gen` for readability in multi-step actions.

## Avoid

- Anonymous function wrappers for critical operations that should be traceable.
- Overusing `Effect.fn` for one-off local lambdas with no reuse.

## Minimal example

```ts
import { Effect } from "effect";

const parseXml = Effect.fn("BoeParser.parseXml")((xml: string) =>
  Effect.sync(() => ({ size: xml.length })),
);
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`
- `docs/boe-xml-parser-architecture.md`
- `docs/node-extraction-guide.md`
- `docs/boe-xml-inconsistencies-study.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts
- https://effect.website/docs/observability/tracing
