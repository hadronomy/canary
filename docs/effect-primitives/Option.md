# Option best practices

## When to use

- Use `Option` to represent optional data without `null` or `undefined` ambiguity.
- Use it for absence/presence, not for error semantics.

## Recommended patterns

- Convert nullable values at boundaries (`Option.fromNullable`) and keep downstream logic explicit.
- Use `Option.match` when branching behavior for `Some` versus `None`.
- Lift to `Effect` only when you need effectful fallback logic.

## Avoid

- Encoding operational failures in `Option`; use typed errors for that.
- Reintroducing nullable checks after converting to `Option`.

## Minimal example

```ts
import { Option } from "effect";

const maybeTitle = Option.fromNullable("Doc title");

const rendered = Option.match(maybeTitle, {
  onNone: () => "Untitled",
  onSome: (title) => title,
});
```

## Used in proposal docs

- `docs/fragment-based-search-architecture.md`
- `docs/boe-xml-parser-architecture.md`

## References

- https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Option.ts
- https://effect.website/docs/data-types/option
