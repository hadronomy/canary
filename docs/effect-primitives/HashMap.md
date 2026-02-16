# HashMap best practices

## When to use

- Use `HashMap` for immutable key-value collections with persistent update semantics.
- Prefer it over plain objects when you need functional updates and predictable structural sharing.

## Recommended patterns

- Use `HashMap.make` or `HashMap.fromIterable` for creation.
- Handle lookups through `Option` (`HashMap.get` returns `Option`).
- Chain updates functionally (`HashMap.set`, `HashMap.remove`) instead of mutating shared objects.

## Avoid

- Treating `HashMap.get` as nullable; always branch on `Option`.
- Switching back and forth between object and hashmap representations in hot paths.

## Minimal example

```ts
import { HashMap, Option } from "effect";

const scores = HashMap.make(["a", 1], ["b", 2]);

const updated = HashMap.set(scores, "a", 3);

const value = HashMap.get(updated, "a");

const rendered = Option.match(value, {
  onNone: () => "missing",
  onSome: (score) => String(score),
});
```

## Used in proposal docs

- Not currently referenced in `docs/*proposal*`; added as a requested primitive reference.

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/HashMap.ts
- https://effect.website/docs/data-types/hashmap
