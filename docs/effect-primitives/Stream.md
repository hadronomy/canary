# Stream best practices

## When to use

- Use `Stream` for large datasets, incremental pipelines, or unbounded sources.
- Use it when batching, backpressure, and staged transformations matter.

## Recommended patterns

- Start from `Stream.fromIterable` (or source adapters), transform with `Stream.mapEffect` for effectful steps.
- Batch with `Stream.grouped` before external calls (embeddings, writes, APIs).
- Use `Stream.catchAll` for local recovery and telemetry.
- Finalize execution explicitly with `Stream.runDrain` or collection operators.

## Avoid

- Using `Stream.map` for effectful functions (use `Stream.mapEffect`).
- Building a stream without a terminal runner.

## Minimal example

```ts
import { Effect, Stream } from "effect";

const pipeline = Stream.fromIterable(["a", "b", "c"]).pipe(
  Stream.grouped(2),
  Stream.mapEffect((batch) => Effect.sync(() => batch.map((s) => s.toUpperCase()))),
  Stream.flatMap((batch) => Stream.fromIterable(batch)),
  Stream.tap((value) => Effect.log(`Processed: ${value}`)),
  Stream.runDrain,
);
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Stream.ts
- https://effect.website/docs/stream/introduction
