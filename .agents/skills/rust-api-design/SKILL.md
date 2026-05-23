---
name: rust-api-design
description: Design or review Rust APIs with high taste for fluent builders, small traits, strongly typed operations, async ergonomics, and delightful call sites. Use when shaping client libraries, service handles, request builders, endpoint methods, pagination abstractions, typed wrappers, or any Rust interface where ergonomics, consistency, and type safety matter.
---

# Rust API Design

## Overview

Design Rust APIs that read naturally at the call site, hide transport and plumbing details, and stay predictable internally. Study the existing code first, then add the smallest abstraction that preserves the codebase's naming, ownership, async, and error style.

## Workflow

1. Inspect the existing surface before proposing anything.
2. Identify the dominant API shape already present in the codebase.
3. Preserve family resemblance with nearby types and methods.
4. Introduce the smallest focused type that improves correctness or readability.
5. Keep execution and plumbing boring behind a narrow boundary.

## Inspect First

Read the local code before designing:

- Look at naming patterns for methods, structs, traits, and error types.
- Check whether the codebase prefers builders, free functions, handles, or plain structs.
- Inspect how async work is triggered: direct `async fn`, `IntoFuture`, explicit `send`, streams, or background tasks.
- Inspect how ownership is handled: borrowed first, owned first, `Cow`, cloning, or `Arc`.
- Inspect how response shapes are modeled: concrete values, wrappers, typed pages, streams, or enums.
- Inspect how similar operations stay consistent across a family of methods.

Do not add a beautiful abstraction that feels imported from another library if the surrounding code wants something simpler.

## Design Principles

### Make verbs create operations

Prefer short domain verbs on the main handle and focused nouns for the returned operation type.

Examples:

- `client.publish(msg) -> Publish`
- `db.select("person") -> Select`
- `store.list(limit) -> List`

This keeps the surface readable and gives the operation a place to hold refinement methods or execution.

### Wrap raw values in semantic types

Prefer small wrapper types when a raw primitive wants behavior, invariants, formatting rules, or a safer API.

Good wrappers:

- token or secret types that redact `Debug`
- cursor, limit, offset, and page types
- credential shapes
- typed resource identifiers

Do not wrap primitives just to look sophisticated. Wrap them when the wrapper prevents real mistakes or creates a meaningfully better surface.

### Keep operation structs small

Operation structs should hold only the state needed to perform one action. Treat them like envelopes for one execution, not mini frameworks.

Good fields:

- borrowed or owned handle
- resource identifier
- options already chosen
- marker state when it removes real mistakes

Avoid packing logging, retries, metrics, parsing, and deserialization policy into each builder.

### Build pipelines out of small value transforms

Prefer builder methods that take one operation value and return a refined operation value.

Examples:

- `use_ns(...).use_db(...)`
- `select(...).range(...).live()`
- `list(limit).after(cursor).into_stream()`

This gives the API a compositional, monadic feel without turning it into theory-first code. Each step should refine meaning, not just accumulate flags.

### Let the call site read like a sentence

Aim for APIs that read in the order a user thinks:

```rust
client
    .list(limit)
    .after(cursor)
    .into_stream()
```

```rust
db
    .use_ns("app")
    .use_db("main")
    .await?
```

Each step should feel obvious from its name alone.

### Hide complexity below the operation layer

Push repetitive transport and response-shape work into lower helpers. Operation implementations should usually:

1. normalize inputs
2. perform one call
3. convert one result

If an operation implementation grows large, move the shared plumbing down rather than pushing more generic machinery up.

### Preserve family resemblance

If one method family uses `into_owned`, other borrowed builders should likely offer it too. If one request family uses typed wrappers for limits or cursors, new pagination APIs should follow that shape.

Consistency is part of ergonomics.

### Use type-state only where the operation meaning changes

Use marker types or changed builder output types when a method genuinely changes what the operation can do or return.

Good uses:

- live query mode versus one-shot query mode
- authenticated versus unauthenticated request state
- page walkers that move from one-page fetch to sequential stream

Bad uses:

- encoding every optional flag in the type system
- requiring users to read long generic signatures just to do common work

## Naming Rules

- Use domain verbs for entry methods: `signin`, `select`, `publish`, `list`, `watch`.
- Use nouns for operation types: `Signin`, `Select`, `Publish`, `Paginated`.
- Use refinement names that describe meaning, not transport: `range`, `after`, `limit`, `namespace`.
- Prefer short names when the receiver already gives context.
- Avoid protocol-heavy names unless the protocol distinction matters semantically.
- Use semantic type names for wrappers: `Cursor`, `Limit`, `Jwt`, `BlobId`, `Namespace`.

## Trait And Generic Rules

- Spend generics only where they remove a real invalid state or preserve valuable output typing.
- Prefer tiny traits with one semantic job over broad capability traits.
- Use marker types or `PhantomData` quietly when they encode legal combinations well.
- Keep bounds near the method or impl that needs them.
- Prefer concrete associated types or concrete wrappers over highly parameterized trait webs.
- Use short generic names like `C`, `R`, and `T` when the role is conventional and obvious in local context.
- Use descriptive generic names like `Action`, `Response`, or `Item` when the parameter carries domain meaning that would be muddy as a single letter.

Good uses:

- credential traits that constrain valid auth payloads
- typed cursor or limit wrappers
- output markers that distinguish `Value`, `Option<T>`, and `Vec<T>`

Avoid:

- generic parameters added only for theoretical reuse
- state-machine builders whose type signatures are louder than their behavior
- wrappers that add no behavior, no invariants, and no useful surface area

## Async And Builder Rules

- Separate constructing the operation from executing it.
- Use `IntoFuture` for one-shot operations when `request.await?` is the most natural shape.
- Use explicit methods like `into_stream` or `watch` when there are multiple execution modes.
- Mark lazy operations `#[must_use]`.
- Borrow by default when possible and add `into_owned()` when the operation may need to move across tasks or outlive a borrow.
- Box futures only at ergonomic boundaries where hiding type noise improves the surface materially.

Do not make everything `IntoFuture`. Use it when the type has one obvious execution path.

## Error Rules

- Prefer one main error type per API layer.
- Convert errors close to the failing step.
- Keep builder construction cheap and unsurprising.
- Avoid bespoke error enums for every tiny method unless callers truly need to branch on them.
- Make fallible transitions explicit if a bad state can be expressed.
- Let wrapper types improve safety around secrets and tokens by controlling formatting and extraction.

## Anti-Patterns

- Do not invent a builder for a plain helper that should just be a function.
- Do not hide execution behind surprising side effects.
- Do not expose transport, serialization, or routing details in public method names.
- Do not replace semantic code with macros that define the whole API.
- Do not abstract similar methods so hard that their individual meaning disappears.
- Do not add type-state theater where a simple runtime check would be clearer.
- Do not insist on long generic names when short ones are clearer in local context.
- Do not insist on short generic names when the role is domain-specific and deserves a real word.

## Review Checklist

- Does the call site read naturally from left to right?
- Is the entry method named as a domain action?
- Is the returned type a focused operation value rather than a bag of knobs?
- Are generics earning their keep?
- Are wrapper types earning their keep?
- Is borrowing the default with an explicit ownership escape if needed?
- Is async execution triggered in an obvious place?
- Is the implementation small enough to trust at a glance?
- Does this look like it belongs next to the neighboring APIs?
- Did you hide only plumbing, not meaning?
- Did any pipeline step materially refine the operation, or is it just decorative chaining?

## Example Shape

```rust
#[must_use = "futures do nothing unless awaited"]
pub struct Publish<'a, C> {
    client: Cow<'a, Client<C>>,
    msg: Message,
}

impl<C> Client<C> {
    pub fn publish(&self, msg: Message) -> Publish<'_, C> {
        Publish {
            client: Cow::Borrowed(self),
            msg,
        }
    }
}

impl<'a, C> Publish<'a, C> {
    pub fn into_owned(self) -> Publish<'static, C>
    where
        C: Clone,
    {
        Publish {
            client: Cow::Owned(self.client.into_owned()),
            msg: self.msg,
        }
    }
}

impl<C> IntoFuture for Publish<'_, C>
where
    C: Connection,
{
    type Output = Result<Ack>;
    type IntoFuture = BoxFuture<'static, Self::Output>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(async move {
            let req = self.msg.encode()?;
            self.client.router.send(req).await
        })
    }
}
```

## Taste Summary

Prefer APIs that feel fluent but not magical, strongly typed but not academic, and internally boring enough that a future maintainer trusts them quickly.
