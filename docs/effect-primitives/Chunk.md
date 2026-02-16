# Chunk best practices

## When to use

- Use `Chunk` for immutable, efficient batch data handling in effectful pipelines.
- Use it at stream boundaries where grouped elements arrive as chunks.

## Recommended patterns

- Keep data as `Chunk` while transforming, convert with `Chunk.toArray` only at integration boundaries.
- Apply transformations with `Chunk.map` and related combinators.
- Prefer chunk-level processing for better throughput in batch operations.

## Avoid

- Eagerly converting every chunk to arrays mid-pipeline.
- Mixing mutable array updates with chunk-oriented flow.

## Minimal example

```ts
import { Chunk } from "effect";

const names = Chunk.fromIterable(["a", "b"]);
const upper = Chunk.map(names, (name) => name.toUpperCase());
const materialized = Chunk.toArray(upper);
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Chunk.ts
- https://effect.website/docs/data-types/chunk
