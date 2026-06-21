<div align="center">
  <img src="/.github/images/github-header-image.webp" alt="GitHub Header Image" width="auto" />
  <p></p>
  <a href="https://github.com/hadronomy/canary/blob/main/LICENSE">
    <img
      alt="Content License"
      src="https://img.shields.io/github/license/hadronomy/canary?style=for-the-badge&logo=starship&color=ee999f&logoColor=D9E0EE&labelColor=302D41"
    />
  </a>
  <a href="https://github.com/hadronomy/canary/stargazers">
    <img
      alt="Stars"
      src="https://img.shields.io/github/stars/hadronomy/canary?style=for-the-badge&logo=starship&color=c69ff5&logoColor=D9E0EE&labelColor=302D41"
    />
  </a>
  <p></p>
  <p align="center">
    <em>With great <strong>retrieval</strong> comes great <strong>legislation</strong></em><br>
    <sub>— Uncle Ben (probably)</sub>
  </p>
  <p></p>
  <a href="#getting-started">Getting Started</a> •
  <a href="#overview">Overview</a> •
  <a href="#repository-layout">Repository Layout</a> •
  <a href="#license">License</a>
  <hr />
</div>

> [!WARNING]
> Canary is still under heavy development.

Canary is an AI legal assistant for Spanish law (for now). It parses BOE
(Boletín Oficial del Estado) documents into navigable temporal fragments and
indexes them with poly-vector matryoshka embeddings for legal retrieval.

The point is not just to find matching text. Canary keeps the shape of each
document, the links between norms, and the valid version of the law inside the
retrieval model itself. That makes it possible to answer with the right
article, the right surrounding context, and the right legal version for the
question at hand.

It is built for legislators, lawyers, public sector practitioners, law and
political science students, and anyone else who needs something better than
keyword search over legal text.

## Overview

Canary treats law as structured material.

It parses BOE documents into legal fragments such as _libros_, _títulos_,
_capítulos_, _secciones_, _artículos_, and _párrafos_. Those fragments keep
their place in the hierarchy, so the system can move up, down, and sideways
through the document instead of treating every paragraph as an isolated chunk.

It also keeps temporal validity in the model. If a provision changes over time,
the system can distinguish what is currently in force from what used to be in
force, and can retrieve the version that actually matters for a question.

The same idea applies to legal references. Modifications, repeals,
interpretations, and related citations are part of the retrieval path. If one
norm changes another, Canary can follow that relationship instead of pretending
the documents are unrelated.

## Retrieval model

Retrieval happens in stages.

First, Canary uses smaller scout vectors to search broadly and cheaply. Then it
uses larger full vectors to rerank candidates with more precision. After that,
it rebuilds context from the document hierarchy and follows relevant legal
references when the answer depends on neighboring provisions or linked norms.

That combination matters. A legal question often depends on more than the first
matching paragraph. It may depend on the article above it, the section around
it, the norm that modified it, or the version that was valid on a particular
date.

Canary is built around that reality.

## Document model

BOE documents are represented as navigable legal hierarchies.

Each fragment carries:

- its structural position in the document
- its legal citation identity
- its temporal validity
- its links to related legal material

That gives retrieval a real document model to work with instead of a flat pile
of embeddings.

## Tech stack

The core of Canary is written in Rust. That includes the parser, the server,
the file workflows, the database integration, and the supporting runtime
components around them. The HTTP layer runs on Axum, operational state lives in
SurrealDB, and orchestration uses Temporal.

The application layer around that core is written in TypeScript. The web UI,
the TUI, the docs site, and the shared frontend tooling live in the TypeScript
workspace and run on Bun.

## Repository layout

### Rust crates

- `crates/parser` (`document-hierarchy`) parses BOE documents into the
  navigable document tree and fragment model
- `crates/server` (`canary-server`) exposes the HTTP API, file flows, and
  runtime application wiring
- `crates/database` owns SurrealDB runtime access and the Surrealkit schema
  project under `crates/database/database/`
- `crates/public-id` provides typed public identifiers for API resources

### TypeScript apps and packages

- `apps/web` is the main web client
- `apps/tui` is the terminal UI
- `apps/fumadocs` is the documentation site
- `packages/env` and `packages/config` hold shared TypeScript configuration

## Getting started

### Prerequisites

- Rust toolchain
- [Mise](https://mise.jdx.dev/)
- [Bun](https://bun.sh/)
- Docker for the local SurrealDB workflow

### Install local tooling

```sh
mise i
bun install
```

### Start the local database

```sh
just db-up
just db-sync
```

If you want seed data and schema-focused tests as well:

```sh
just db-seed
just db-test
```

### Run the server

```sh
just server
```

At that point, SurrealDB is running locally, the schema is applied, and the
Rust server is running against the current workspace code.

### Run the frontend or docs

```sh
bun run dev:web
bun --cwd apps/fumadocs dev
```

## Common commands

- `just help`
- `just fmt`
- `just check`
- `just db-status`
- `just db-down`
- `cargo test --workspace`

## License

MIT
