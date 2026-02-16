# Schema best practices

## When to use

- Use `Schema` at boundaries (HTTP, DB, external files) to validate and decode unknown data.
- Use `Schema.TaggedError` for typed domain errors with structured fields.

## Recommended patterns

- Model entities with `Schema.Struct`, unions with `Schema.Union`, and recursion with `Schema.suspend`.
- Keep optionality explicit via `Schema.optional`.
- Decode in effects (`Schema.decode`) for error-aware workflows; reserve sync decode for trusted constants.
- Use small, composable schemas and reuse them across modules.

## Avoid

- Trusting external payloads without schema decoding.
- Defining very large monolithic schemas when decomposition is possible.

## Minimal example

```ts
import { Effect, Schema } from "effect";

const Node = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
});

class ParseError extends Schema.TaggedError("ParseError")("ParseError", {
  message: Schema.String,
}) {}

const decodeNode = (input: unknown) =>
  Schema.decodeUnknown(Node)(input).pipe(
    Effect.mapError((cause) => new ParseError({ message: String(cause) })),
  );
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`
- `docs/boe-xml-parser-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schema.ts
- https://effect.website/docs/schema/introduction
