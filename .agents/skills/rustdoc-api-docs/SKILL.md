---
name: rustdoc-api-docs
description: Write or update delightful Rust documentation with rustdoc, doctests, sectioned API docs, and accurate examples that stay in sync with the code. Use when documenting public Rust crates, modules, structs, enums, traits, functions, methods, builders, async APIs, or when reviewing docs quality after API changes.
---

# Rustdoc API Docs

## Purpose

Write Rust documentation that is pleasant to read, realistic at the call site, and hard to let drift out of date. Treat rustdoc as part tutorial, part contract, and part API design surface.

## When To Use

Use this skill when:

- adding or revising public Rust APIs
- reviewing docs quality after changing signatures or behavior
- writing crate-level or module-level docs
- adding doctests and examples
- documenting errors, panics, or safety invariants
- improving discoverability with links, aliases, or re-export presentation

## Core Taste

Great rustdoc explains why an API exists, not just how to call it. The best examples feel like small, believable programs rather than toy fragments. The docs should mirror the public API shape closely enough that changing code without changing docs feels obviously wrong.

For crate and module landing pages, aim higher than a plain summary. Those pages
should read like editorial front doors to the subsystem: clear first sentence,
strong sectioning, thoughtful emphasis, and enough structure that a reader can
scan and then dive deeper without feeling lost.

Write like one engineer helping another use the code correctly. Favor concrete
mechanical truth over architecture slogans. Prefer "prevents mixing file IDs
and upload IDs" to "keeps the boundary honest". When a sentence starts
defending the elegance of the design instead of explaining behavior, rewrite it.

## Workflow

1. Inspect the public API surface that changed.
2. Read nearby docs to preserve voice, level of detail, and example style.
3. Update crate, module, and item docs together when the story changed.
4. Prefer one realistic example over several mechanical ones.
5. Add or update `Errors`, `Panics`, and `Safety` sections when relevant.
6. Run doctests or targeted tests after editing docs.

## What To Learn From Strong APIs

SurrealDB’s method docs are a good model for API docs that feel alive:

- examples are realistic and use the actual fluent call sites
- async examples show enough setup to be copyable
- related methods share one documentation rhythm across the family
- docs explain the user goal first, then show the call
- `no_run` is used when examples are real but environment-dependent

Use that style. Avoid examples that only prove syntax.

## Documentation Rules

### Start with the user-facing role

Begin each public item by naming what it does in domain terms. The first sentence should help a reader decide whether this item is the right one.

### Prefer concrete consequences over abstract intent

Readers care about what the type, function, or module does, what mistake it
prevents, and what assumption it encodes. Say that directly.

Good:

- "Prevents mixing file IDs and upload IDs after deserialization."
- "Stores the staged object key until promotion succeeds."

Avoid:

- "Keeps the API boundary honest."
- "Encodes the architecture's core philosophy."
- "Provides a principled abstraction for transport semantics."

Those phrases sound clever, but they make the reader do extra translation work.

### Show real call sites

Prefer examples that use the actual API shape readers will write:

```rust
db.use_ns("app").use_db("main").await?;
```

That is better than pseudo-code or isolated fragments with no surrounding context.

### Explain why, not only how

A good example should reveal the intended use case, not merely the syntax of the method call.

### Cut scaffolding phrases

Remove empty setup language such as:

- "The core idea is simple"
- "This type basically"
- "In practice"
- "What this really means"

If the sentence still works after deleting the phrase, delete it.

### Keep examples copy-friendly

- Prefer examples that compile.
- Use `?` instead of `unwrap`.
- Use hidden setup lines with `#` when necessary.
- Use `no_run` when the example is correct but depends on an external service, filesystem, network, or environment.

### Document failure behavior explicitly

Add sections when they matter:

- `# Errors`
- `# Panics`
- `# Safety`

Treat these as part of the contract, not optional commentary.

### Link the important nouns

Use rustdoc links for related types, traits, modules, and methods. Make the docs easy to explore from inside docs.rs.

For module and crate docs, prefer rich _intra-doc navigation_ over repeating
raw type names in prose. If readers should jump to another item, give them a
good link.

### Hide unhelpful details

Prefer `pub(crate)` and `#[doc(hidden)]` for implementation-only details that should not clutter the public story. Use `#[doc(inline)]` and `#[doc(no_inline)]` deliberately for re-exports.

### Improve discoverability

Use `#[doc(alias = \"...\")]` when users may search for another common term, protocol name, or legacy name.

### Use rustdoc's editorial surface deliberately

Rustdoc is not limited to plain paragraphs and fenced code blocks. Use its
Markdown support with taste:

- **bold** for truly important constraints or guarantees
- _italics_ for gentle emphasis or domain terms
- tables when a module map or capability overview genuinely scans better that way
- footnotes when a small nuance would otherwise interrupt the flow
- warning callouts with HTML blocks when a misuse would create a real hazard

These tools should make the page feel more polished and easier to navigate, not
busier.

### Sound human without sounding casual

Human writing in technical docs is:

- direct
- specific
- slightly warm
- free of canned transitions
- willing to say "this prevents X" or "use Y when Z"

Human writing is not:

- jokey by default
- slogan-heavy
- overly reverent about the design
- stuffed with internal architecture vocabulary

The goal is not "friendly marketing copy". The goal is clean, confident prose
that sounds like a careful engineer.

## Keeping Docs Updated

When changing code, update docs in the same patch if any of these changed:

- the call-site shape
- required setup or prerequisites
- result or error behavior
- panic behavior
- safety invariants
- return type interpretation
- naming or discoverability

Do not leave docs “for later” after an API rename or builder change. Rust docs drift fastest when examples still compile conceptually but no longer represent the preferred usage.

## Crate And Module Docs

- Use `//!` docs in `lib.rs` and major module roots.
- Give crate-level docs an introduction, a realistic getting-started example, and any important feature or environment notes.
- For modules, explain why the module exists and how it fits the rest of the crate.
- Treat major module docs as landing pages. A strong module page often benefits
  from:
  - a short opening promise
  - a brief "at a glance" map
  - one realistic example or workflow
  - explicit invariants or lifecycle notes
  - links to the key submodules or types

## Async And Builder Docs

- Show where execution actually begins.
- If a type is lazy or awaitable, make that obvious in the prose or example.
- If a builder has multiple execution modes like `await`, `into_stream`, or `watch`, show the distinction clearly.
- Document ownership escape hatches like `into_owned()` when they matter to real usage.

## Documentation-Friendly API Review

If an item is hard to document cleanly, the API may need design work. Watch for:

- names that require too much explanation
- builders with unclear execution points
- generic parameters that dominate the docs
- too many states or flags to explain clearly
- examples that require awkward scaffolding to make sense

Hard-to-document APIs are often hard-to-use APIs.

## Anti-Patterns

- Do not write examples that only show syntax with no realistic purpose.
- Do not use `unwrap` in public-facing examples unless the point of the example is panicking behavior.
- Do not repeat the type or function signature in prose.
- Do not document private implementation details as if users must care.
- Do not hide meaningful failure behavior.
- Do not leave doctests stale after changing builders, wrappers, or result types.
- Do not overuse `no_run` for examples that could compile and run normally.
- Do not use metaphor or virtue-language when a plain engineering statement is
  clearer.
- Do not write abstraction-first prose when a concrete example or consequence
  would explain the API faster.

## Review Checklist

- Does the first sentence tell the reader what the item is for?
- Does the example show the real intended call site?
- Does the example use `?` and realistic setup?
- Should the example be `rust`, `no_run`, or hidden-line doctest?
- Are `Errors`, `Panics`, and `Safety` documented where relevant?
- Are important related types and methods linked?
- Are re-exports documented cleanly with the right `#[doc(...)]` attributes?
- Did this API change require a documentation update in the same patch?
- Would a user copy the example and be guided toward the preferred usage?

## Example Shape

````rust
/// Uploads a file fragment and returns its typed public ID.
///
/// Use this when the caller already has validated bytes and wants the fragment
/// to participate in the normal file lifecycle. The returned [`PublicId`] can
/// be sent back to API clients directly, while the server keeps working with
/// the typed domain ID internally.
///
/// This method does not publish the fragment immediately. It writes the bytes
/// into staged storage first, then commits the metadata once the upload
/// succeeds. That prevents partially written fragments from showing up in the
/// ready set.
///
/// # Examples
///
/// ```no_run
/// # use std::error::Error;
/// # async fn run(service: FileService, actor: ActorId) -> Result<(), Box<dyn Error>> {
/// let fragment = service
///     .upload_fragment(actor)
///     .name("article-12.txt")
///     .content_type("text/plain")
///     .bytes("El derecho a...".as_bytes())
///     .await?;
///
/// assert_eq!(fragment.media_type(), Some("text/plain"));
/// println!("public id: {}", fragment.id());
/// # Ok(())
/// # }
/// ```
///
/// # Errors
///
/// Returns an error if the bytes cannot be written, if the fragment metadata is
/// invalid, or if the storage backend rejects the upload.
///
/// # Panics
///
/// Does not panic.
pub fn publish(&self, topic: &str) -> Publish<'_, C> { ... }
````

## Validation

When practical, run:

- `cargo test`
- `cargo test --doc`
- targeted example or integration tests for the documented path

If the repo has linting or docs.rs-specific checks, run those too.

## Taste Summary

Write rustdoc that feels like excellent product writing backed by executable truth. It should guide, reassure, and stay synchronized with the real API shape.

Use the full editorial range of rustdoc when it genuinely helps the reader.
Plain prose is often enough, but the best documentation pages also know when to
use emphasis, tables, callouts, footnotes, aliases, and carefully placed links
to make a subsystem feel legible at a glance.
