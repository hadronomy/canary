# Rust Server Crate Spec

## Goal

Create a new Rust server crate for Canary that feels native to the current Rust workspace, stays small and sharp in its first phase, and gives us an excellent base for parser-backed and retrieval-backed HTTP APIs later.

The target is not "a web server that happens to compile." The target is a crate that is:

- idiomatic Axum, Tower, and Tokio
- explicit about lifecycle, state, and error handling
- easy to test in-process
- easy to grow without turning into a monolithic `main.rs`
- fast by default, but not clever for its own sake

## Explicit Scope For This Phase

This phase is about scaffolding the crate well, not prematurely implementing the whole product.

Phase 1 should include:

- a new crate at `crates/server`
- package name `canary-server`
- a clean `lib.rs` + `main.rs` split
- typed configuration loading
- runtime construction
- observability bootstrap
- graceful shutdown coordination
- application state
- HTTP router composition
- foundational middleware
- health and readiness endpoints
- a parser-facing service boundary ready to integrate `document-hierarchy`
- a SurrealDB-facing service boundary and configuration model
- database connection bootstrap
- a small database service abstraction
- a file-handling architecture that supports streaming, multipart, MIME detection, and pluggable blob storage
- high-quality tests for config, health, readiness, and middleware behavior

Phase 1 should not include:

- retrieval SQL
- schema-heavy persistence implementation
- background data workflows built on top of the database
- background ingestion orchestration
- OpenAPI generation
- authentication
- caching
- WebSocket/SSE features

Those can come later without warping the initial design.

## Non-Goals

- We are not porting the TypeScript server.
- We are not cloning `inari-server`; we are borrowing its good bones and discarding the domain-specific weight.
- We are not building a dependency-injection framework.
- We are not introducing actor systems, plugin registries, or macro-heavy service abstractions.

## High-Signal Sources

These are the primary sources I will use when implementing the crate. They are high-signal because they come from the framework authors, the official docs, or a working local reference with the same architectural concerns.

### Official Axum sources

1. Axum `Router` docs  
   <https://docs.rs/axum/latest/axum/struct.Router.html>

   Why it matters:
   - documents the recommended state-sharing pattern
   - explicitly recommends returning `Router<AppState>` from functions and applying `.with_state(...)` at the composition boundary
   - anchors the route-module design

2. Axum `FromRef` docs  
   <https://docs.rs/axum/latest/axum/extract/derive.FromRef.html>

   Why it matters:
   - gives the cleanest substate extraction pattern
   - lets handlers depend on narrow state slices instead of the whole `AppState`

3. Axum error handling docs  
   <https://docs.rs/axum/latest/axum/error_handling/index.html>

   Why it matters:
   - clarifies Axum’s `Infallible` error model
   - directly informs how we wrap fallible middleware with `HandleErrorLayer`

4. Axum middleware docs  
   <https://docs.rs/axum/latest/axum/middleware/>

   Why it matters:
   - reinforces middleware ordering and fallible middleware handling

5. Axum repository and examples  
   <https://github.com/tokio-rs/axum>

   Why it matters:
   - the examples are where the framework’s intended composition style is most obvious

### Official Tower and Tower-HTTP sources

6. Tower `ServiceBuilder` docs  
   <https://docs.rs/tower/latest/tower/builder/struct.ServiceBuilder.html>

   Why it matters:
   - layer order is part of correctness, not just style
   - informs how we compose timeout, tracing, request IDs, body limits, panic capture, and optional CORS

7. Tower-HTTP request ID docs  
   <https://docs.rs/tower-http/latest/tower_http/request_id/index.html>

   Why it matters:
   - explicitly documents the order required so request IDs appear correctly in trace logs

8. Tower-HTTP `TraceLayer` docs  
   <https://docs.rs/tower-http/latest/tower_http/trace/struct.TraceLayer.html>

   Why it matters:
   - informs request/response/failure logging

9. Tower-HTTP compression docs  
   <https://docs.rs/tower-http/latest/tower_http/compression/struct.CompressionLayer.html>

   Why it matters:
   - useful for deciding whether compression is default-on or feature-gated

### Official Tokio sources

10. Tokio graceful shutdown topic  
    <https://tokio.rs/tokio/topics/shutdown>

    Why it matters:
    - it gives the right mental model: detect shutdown, broadcast shutdown, await shutdown
    - this will be the basis for our shutdown coordinator

11. Tokio runtime builder docs  
    <https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html>

    Why it matters:
    - runtime tuning should be explicit and documented
    - worker thread count, max blocking threads, thread names, stack size, and `enable_all()` belong here

12. Tokio `mini-redis` repository  
    <https://github.com/tokio-rs/mini-redis>

    Why it matters:
    - it is still one of the best real examples of graceful shutdown and task supervision without unnecessary abstraction

### Local reference

13. `inari-server` local crate  
    `/Users/hadronomy/repos/inari/crates/inari-server`

    Why it matters:
    - it already demonstrates a clean Rust server layout:
      - `app.rs`
      - `config.rs`
      - `error.rs`
      - `http/`
      - `observability.rs`
      - `runtime.rs`
      - `shutdown.rs`
      - `state.rs`
    - it uses the exact ecosystem we want
    - it is a strong structural reference, even though Canary’s domain is different

## Design Principles

### 1. Keep the API boring and excellent

The best server crate here is not one that shows off. It is one where the reader can guess where things live before opening files.

### 2. Keep state narrow at the handler boundary

Handlers should not routinely extract the whole `AppState`. We will use `FromRef`-derived substates so handlers can ask for the smallest dependency that makes sense.

### 3. Keep the router modular, but not fragmented

We want route modules by concern, not one file per tiny endpoint. The right shape is a handful of coherent route modules.

### 4. Keep startup explicit

The startup flow should be visible in one place:

1. load config
2. init observability
3. build runtime
4. build app
5. serve
6. shut down cleanly

### 5. Keep fallible boundaries typed

Configuration, startup, middleware, and handler failures should be typed and understandable. We should not leak `anyhow` everywhere or let Tower errors bubble out vaguely.

### 6. Keep Phase 1 parser-aware, but not parser-entangled

The server crate should be ready to host parser-backed APIs, but it should not hardwire all parser concerns directly into the HTTP layer. We want a small service boundary for that.

## Proposed Crate Layout

```text
crates/server/
├── Cargo.toml
├── src
│   ├── main.rs
│   ├── lib.rs
│   ├── app.rs
│   ├── config.rs
│   ├── error.rs
│   ├── observability.rs
│   ├── runtime.rs
│   ├── shutdown.rs
│   ├── state.rs
│   ├── services
│   │   ├── mod.rs
│   │   └── parser.rs
│   └── http
│       ├── mod.rs
│       ├── extract.rs
│       ├── response.rs
│       ├── middleware.rs
│       └── routes
│           ├── mod.rs
│           ├── system.rs
│           └── api
│               ├── mod.rs
│               └── v1
│                   ├── mod.rs
│                   └── parse.rs
└── tests
    ├── config_env.rs
    ├── health.rs
    └── readiness.rs
```

## Why This Structure

This structure mirrors the strongest parts of `inari-server`, but trims it to Canary’s actual first-phase needs.

- `main.rs` stays tiny
- `lib.rs` becomes the stable crate surface
- `app.rs` owns assembly and process lifecycle
- `config.rs` owns config loading and defaults
- `state.rs` owns runtime state and substate extraction
- `services/` holds domain-facing service boundaries
- `http/` holds HTTP-only concerns

That keeps domain logic out of middleware glue and keeps HTTP glue out of the domain.

## Public Surface

`lib.rs` should re-export the handful of things a future integration or binary might reasonably need:

- `ServerBuilder`
- `ServerApplication`
- `AppConfig`
- `LoadedConfig`
- `ServerConfig`
- `RuntimeConfig`
- `ObservabilityConfig`
- `AppState`
- `AppError`
- `ConfigError`
- `build_runtime`
- `init_observability`

The crate should feel usable as a library, even if the binary is the main entrypoint.

## Proposed Module Responsibilities

### `main.rs`

Responsibilities:

- install panic reporting if we want it
- load config
- init observability
- build runtime
- run the application

It should stay close to:

```rust
fn main() -> Result<(), AppError> {
    let loaded = LoadedConfig::load()?;
    init_observability(&loaded.settings.observability)?;
    let runtime = build_runtime(&loaded.settings.runtime)?;

    runtime.block_on(async move {
        ServerBuilder::new()
            .with_config(loaded)
            .build()
            .await?
            .run()
            .await
    })
}
```

### `app.rs`

Responsibilities:

- typestate `ServerBuilder`
- `ServerApplication`
- listener binding
- router assembly
- background task supervision
- graceful shutdown orchestration

This is one of the best pieces to borrow from `inari-server`.

I want:

- `ServerBuilder<MissingConfig>`
- `ServerBuilder<WithConfig>`
- `ServerApplication::run()`

That is a delightful pattern here because it keeps startup honest without being heavy.

### `config.rs`

Responsibilities:

- `LoadedConfig`
- `ConfigOrigin`
- `AppConfig`
- `ServerConfig`
- `RuntimeConfig`
- `ObservabilityConfig`
- `HttpConfig`
- future `ParserApiConfig`

Best-practice shape:

- serde-deserializable config structs
- defaults on each config type
- environment overrides
- optional explicit config file path via env var
- a human-readable `ConfigOrigin`

I plan to follow `inari-server`’s layered config pattern rather than inventing something new.

### `runtime.rs`

Responsibilities:

- one function: `build_runtime(&RuntimeConfig) -> Result<Runtime, AppError>`

Best-practice choices:

- use `tokio::runtime::Builder::new_multi_thread()`
- call `.enable_all()`
- set runtime name and thread names
- expose worker thread count, blocking thread limit, stack size, keep-alive, event interval, and global queue interval via typed config

Reason:

Tokio’s builder is explicit, stable, and gives us a future-proof place to tune behavior without contaminating `main.rs`.

### `observability.rs`

Responsibilities:

- install tracing subscriber
- support compact pretty logs and JSON logs
- env filter override
- optional request-aware span fields later

Best-practice choices:

- `tracing_subscriber::registry()`
- `EnvFilter` from env first, config second
- no OpenTelemetry in phase 1 unless truly needed

Reason:

Tracing should be clean on day one, but OTLP is a complexity cliff if we add it before the server needs it.

### `shutdown.rs`

Responsibilities:

- shutdown coordinator
- signal handling
- wait/broadcast helpers

Best-practice shape:

- detect shutdown via `tokio::signal`
- broadcast via a coordinator type
- wait for all critical tasks to finish or time out

I am open to using `tokio_util::sync::CancellationToken`, but only if it makes the implementation cleaner than a watch-based coordinator. The default plan is to start with a small explicit coordinator like `inari-server` unless task fan-out proves that `CancellationToken` makes the surface markedly cleaner.

### `state.rs`

Responsibilities:

- `AppState`
- startup timestamp and uptime
- readiness state
- parser service handle
- future retrieval service handles
- `FromRef`-friendly substates

Best-practice shape:

- `AppState` wraps `Arc<AppStateInner>`
- clone is cheap
- extractors can ask for narrow state types

I want `AppState` to be the only place that knows how the application is wired, while handlers consume smaller, derived substates.

### `services/parser.rs`

Responsibilities:

- define the parser-facing boundary used by the HTTP layer

Phase 1 should not wire every parser concern directly into handlers. It should establish something like:

```rust
#[derive(Clone)]
pub struct ParserService;

impl ParserService {
    pub fn parse_document(&self, bytes: &[u8]) -> AppResult<...> { ... }
}
```

This keeps the HTTP layer from speaking directly to crate internals and gives us a stable seam for tests and future evolution.

### `services/files.rs`

Responsibilities:

- define the file-facing boundary used by the HTTP layer
- stage uploads
- validate content type and size policy
- persist accepted blobs through a storage backend
- serve dynamic blob downloads

This service should own file semantics so handlers do not need to know:

- how uploads are staged
- how MIME is detected
- whether bytes are stored locally or remotely
- how download headers are assembled

### `http/mod.rs`

Responsibilities:

- build the app router
- apply middleware
- wire route trees together

This module should expose one function:

- `router(state: &AppState) -> AppResult<Router<AppState>>`

That mirrors `inari-server` and matches Axum’s preferred composition style well.

### `http/middleware.rs`

Responsibilities:

- request/response middleware stack
- `HandleErrorLayer`
- timeout
- request IDs
- tracing
- optional compression
- body limit
- optional CORS later if needed

This file matters because middleware order is part of correctness.

Planned order:

1. body limit
2. `HandleErrorLayer`
3. `TimeoutLayer`
4. sensitive headers
5. set request ID
6. trace layer
7. propagate request ID
8. panic catch
9. compression

Reason:

That ordering follows official Axum and Tower-HTTP guidance, especially the request ID + trace ordering documented in `tower-http`.

### `http/routes/system.rs`

Responsibilities:

- `GET /healthz`
- `GET /readyz`
- maybe `GET /version` if we want it

This should be the first route module, and it should be excellent.

### `http/routes/api/v1/parse.rs`

Responsibilities:

- parser-backed endpoints only

Phase 1 proposal:

- `POST /api/v1/parse/document`
- request body is XML bytes or a typed request shape
- response shape is intentionally modest at first, probably:
  - metadata
  - section count
  - node count
  - maybe root summary, not the whole tree

Why:

This gives the new crate a real integration target without prematurely designing the final public API for retrieval.

### `http/routes/api/v1/files.rs`

Responsibilities:

- file upload endpoints
- file download endpoints
- file metadata endpoints if needed later

Phase 1 does not need the full final file API, but it should reserve a coherent route module for it.

## File Handling

This server needs a first-class file-handling design. The goal is to support:

- browser form uploads
- raw binary uploads
- streaming downloads
- local static file serving
- MIME detection
- content-disposition handling
- pluggable blob storage

The clean way to do this in Axum is not one magical upload primitive. It is a small stack, with each path doing one job well.

### High-signal sources

These are the sources informing this design:

1. Axum multipart docs  
   <https://docs.rs/axum/latest/axum/extract/multipart/struct.Multipart.html>

2. Axum multipart field docs  
   <https://docs.rs/axum/latest/axum/extract/multipart/struct.Field.html>

3. Axum body docs  
   <https://docs.rs/axum/latest/axum/body/struct.Body.html>

4. Axum `DefaultBodyLimit` docs  
   <https://docs.rs/axum/latest/axum/extract/struct.DefaultBodyLimit.html>

5. Tower HTTP `RequestBodyLimitLayer` docs  
   <https://docs.rs/tower-http/latest/tower_http/limit/struct.RequestBodyLimitLayer.html>

6. Tower HTTP `ServeFile` and `ServeDir` docs  
   <https://docs.rs/tower-http/latest/tower_http/services/struct.ServeFile.html>  
   <https://docs.rs/tower-http/latest/tower_http/services/struct.ServeDir.html>

7. Tokio `ReaderStream` docs  
   <https://docs.rs/tokio-util/latest/tokio_util/io/struct.ReaderStream.html>

8. `axum_typed_multipart` docs  
   <https://docs.rs/axum_typed_multipart/latest/axum_typed_multipart/>

9. `axum_extra::response::Attachment` docs  
   <https://docs.rs/axum-extra/latest/axum_extra/response/struct.Attachment.html>

10. `axum_extra::response::FileStream` docs  
    <https://docs.rs/axum-extra/latest/axum_extra/response/file_stream/struct.FileStream.html>

11. `mime_guess` docs  
    <https://docs.rs/mime_guess/latest/mime_guess/>

12. `infer` docs  
    <https://docs.rs/infer/latest/infer/>

13. `file-format` docs  
    <https://docs.rs/file-format/latest/file_format/>

14. `object_store` docs  
    <https://docs.rs/object_store/latest/object_store/>

### Design conclusion

The best design is a layered one:

1. `ServeFile` / `ServeDir` for local static files
2. `Body::from_stream(...)` for dynamic or remote blob downloads
3. typed multipart for browser forms
4. raw streamed bodies for large binary uploads
5. magic-byte sniffing for trust
6. extension-based MIME only for hints
7. temp-file staging before promotion
8. metadata in the database, blob bytes in a blob store

That is the combination that gives us the best support surface without turning file handling into one enormous handler.

### Upload lanes

We should support two distinct upload styles.

#### 1. Multipart form uploads

Use this for:

- browser uploads
- form-based admin tools
- mixed metadata + file submissions

The best default is:

- `axum_typed_multipart` for ergonomic typed form parsing
- `NamedTempFile` for large file parts
- field metadata capture for filename and declared content type

This is better than hand-parsing multipart in most app-level endpoints.

#### 2. Raw binary uploads

Use this for:

- API clients
- CLI tools
- large single-blob ingestion

The best path is:

- accept `Request` or `Body`
- consume `Body::into_data_stream()`
- enforce `RequestBodyLimitLayer`
- stream directly to a temp file

This avoids forcing multipart on clients that only want to upload one blob.

### Download lanes

We should support two distinct download styles.

#### 1. Static or local path serving

Use:

- `ServeFile`
- `ServeDir`

This is the best fit when:

- the file is already on local disk
- routing is path-based
- auth or metadata lookup is not dynamic

It gives us:

- safe path handling
- extension-based `Content-Type`
- directory traversal protections
- precompressed variants
- configurable buffer chunk size

#### 2. Dynamic blob serving

Use:

- `ReaderStream`
- `Body::from_stream(...)`
- or `axum_extra::response::FileStream` when range behavior is handy

This is the right path when:

- blob lookup is database-driven
- auth is dynamic
- the backing bytes may come from local FS or object storage
- response headers need to be computed from metadata

### File-type policy

The server should treat client-supplied file information as hints, not truth.

Policy:

- request `Content-Type` is advisory
- filename extension is advisory
- magic-byte detection is authoritative for coarse validation
- deeper validation can be asynchronous or domain-specific later

Recommended stack:

- use `infer` in the hot upload path for fast magic-number detection
- optionally use `file-format` later if richer classification is needed
- use `mime_guess` only as a display or fallback hint

This is important because `mime_guess` itself explicitly warns that it only inspects file extensions and should not be trusted for file correctness.

### Upload lifecycle

The upload lifecycle should be:

1. accept request
2. enforce request-size policy
3. stream bytes to a temp file
4. collect metadata while streaming:
   - byte count
   - content hash
   - sniff buffer
5. detect type from magic bytes
6. validate policy
7. atomically promote to permanent storage
8. persist metadata
9. return blob descriptor

This is the right shape because it separates:

- untrusted incoming bytes
- validated staged content
- durable stored blob

### Blob modeling

The file API should use strong types instead of loose strings.

I want types like:

```rust
pub struct BlobId(uuid::Uuid);
pub struct BlobName(SmolStr);
pub struct BlobSize(u64);
pub struct BlobHash([u8; 32]);
```

And:

```rust
pub enum BlobMedia {
    Known(mime::Mime),
    Unknown,
}
```

And:

```rust
pub struct BlobKind {
    pub declared: Option<mime::Mime>,
    pub sniffed: Option<mime::Mime>,
    pub effective: BlobMedia,
}
```

And separate lifecycle structs:

```rust
pub struct StagedBlob { ... }
pub struct StoredBlob { ... }
```

This keeps:

- user-facing filename
- storage key
- MIME facts
- byte size
- hash

as distinct concepts.

### Blob storage boundary

The HTTP layer should not know whether blob bytes live:

- on local disk
- in object storage
- in an embedded backend

So the crate should define a storage abstraction, something like:

```rust
pub trait BlobStore: Clone + Send + Sync + 'static {
    fn put(&self, staged: StagedBlob) -> impl Future<Output = Result<StoredBlob, BlobError>> + Send;
    fn head(&self, key: &BlobKey) -> impl Future<Output = Result<BlobMeta, BlobError>> + Send;
    fn get(&self, key: &BlobKey) -> impl Future<Output = Result<BlobRead, BlobError>> + Send;
    fn delete(&self, key: &BlobKey) -> impl Future<Output = Result<(), BlobError>> + Send;
}
```

The exact signature can change, but the boundary should exist from day one.

### Storage backend recommendation

The most delightful default is:

- local filesystem implementation first
- shaped so it can later be backed by `object_store`

Why:

- `object_store` already supports:
  - atomic writes
  - multipart upload
  - streaming reads
  - range reads
  - local filesystem and remote backends

That makes it a strong backend abstraction choice when we need one, without forcing cloud concerns into phase 1.

### Content-Disposition policy

For downloads:

- use `inline` when content is meant to render
- use `attachment` when download is intended

And do not manually build raw header strings unless necessary.

Preferred helpers:

- `axum_extra::response::Attachment`
- `headers::ContentDisposition` where appropriate

This matters because correct escaping of filenames is security-sensitive and easy to get subtly wrong.

### Range support

We should not over-implement range behavior in phase 1, but the design should leave room for it.

Policy:

- local static files can rely on the underlying file-serving utilities where practical
- dynamic blob responses may use `axum_extra::response::FileStream` or explicit range logic later
- the blob-store boundary should not assume full-buffer reads

### Body limit policy for files

This is a subtle but important best practice from the Axum docs.

Use:

- `DefaultBodyLimit` for extractors like `Bytes`, `String`, `Json`, and typed multipart routes
- `RequestBodyLimitLayer` for raw streamed bodies and any path where the body is consumed directly

This distinction should be documented in the code because it is easy to get wrong.

### Proposed file-related module layout

The server crate should reserve dedicated modules for this:

```text
src/
  files/
    mod.rs
    error.rs
    meta.rs
    sniff.rs
    stage.rs
    store.rs
    local.rs
    service.rs
```

Responsibilities:

- `files/meta.rs`
  - `BlobId`, `BlobName`, `BlobSize`, `BlobHash`, `BlobKind`, `StoredBlob`
- `files/sniff.rs`
  - `infer` / `file-format` integration
- `files/stage.rs`
  - temp-file staging pipeline
- `files/store.rs`
  - `BlobStore` trait
- `files/local.rs`
  - local filesystem implementation
- `files/service.rs`
  - high-level `FileService`
- `files/error.rs`
  - typed file and storage errors

And then:

```text
src/
  services/
    files.rs
```

can re-export or wrap the higher-level use cases the HTTP layer needs.

### Proposed route surface

The file routes in phase 1 can stay small. The point is to prove the design, not to freeze the whole public API.

Good initial candidates:

- `POST /api/v1/files`
  - multipart or raw upload depending on final handler design
- `GET /api/v1/files/:id`
  - stream a blob
- `GET /api/v1/files/:id/meta`
  - metadata only, optional in phase 1

### Testing strategy for files

Phase 1 tests should cover:

- typed multipart parsing
- raw stream upload size enforcement
- magic-byte MIME detection
- attachment header correctness
- local blob-store roundtrip
- dynamic streaming response returns expected headers

We do not need S3-like integration tests in phase 1.

### Dependency plan for files

I recommend:

- `axum_typed_multipart`
- `axum-extra`
- `tempfile`
- `tokio-util`
- `mime`
- `mime_guess`
- `infer`
- `sha2`
- `uuid`

And later, if needed:

- `file-format`
- `object_store`

### `http/extract.rs`

Responsibilities:

- shared custom extractors, if any

This file may remain small at first, but it is the right home for things like:

- request ID extraction
- typed payload size checks
- future auth/user context extractors

### `http/response.rs`

Responsibilities:

- common response envelopes
- API error response types

This keeps JSON response shape consistent and avoids repeating ad hoc error payload formatting in handlers.

## State Strategy

This is the most important design choice after startup.

### `AppState`

`AppState` should own:

- loaded configuration
- startup time
- readiness
- parser service

It should not own:

- giant mutable business state maps
- route-specific scratch data
- unnecessary locks

### Substates via `FromRef`

This is the preferred Axum pattern for this crate.

Examples:

- handlers that only need parser access extract `State<ParserState>`
- handlers that only need config extract `State<HttpState>`

That keeps handlers declarative and keeps `AppState` from becoming an omnivore dependency.

## Error Model

The server should have two top-level error families:

- `ConfigError`
- `AppError`

`AppError` should cover:

- config
- observability init
- runtime build
- bind
- serve
- signal
- task join
- graceful shutdown timeout
- timeout/middleware errors
- domain-specific user-facing HTTP errors

Best-practice rule:

- internal layers can use rich internal error types
- the HTTP boundary converts them into one consistent JSON error envelope

That keeps the codebase expressive internally while predictable externally.

## HTTP API Shape

### System routes

- `GET /healthz`
- `GET /readyz`

### Parser routes

The parser route in this spec is an example integration target, not a commitment to the final HTTP surface.

For phase 1, I still want one small parser-backed endpoint because it proves the layering:

- router
- handler
- substate extraction
- service boundary
- typed error mapping

But the exact endpoint shape is intentionally provisional.

## Middleware Policy

This is where we should be opinionated.

### Include in phase 1

- body size limit
- request timeout
- panic catch
- request IDs
- structured tracing
- sensitive header filtering
- optional compression

### Exclude in phase 1

- rate limiting
- CORS unless an immediate caller requires it
- auth middleware
- cache middleware

Reason:

The first version should be production-shaped, not production-maximalist.

## Runtime Policy

The runtime should be custom-built, not hidden behind `#[tokio::main]`.

Why:

- explicit knobs
- testable
- matches `inari-server`
- keeps startup flow honest

Config fields should include:

- `worker_threads`
- `max_blocking_threads`
- `thread_stack_size_bytes`
- `thread_keep_alive`
- `event_interval`
- `global_queue_interval`

And `build_runtime` should:

- set a runtime name
- set deterministic thread names
- call `enable_all()`

## Graceful Shutdown Policy

The shutdown model should follow Tokio’s three-step guidance:

1. detect shutdown
2. broadcast shutdown
3. await completion

The server should:

- stop accepting new connections
- notify background tasks
- wait for graceful shutdown
- enforce a configurable grace-period timeout

This belongs in `shutdown.rs` and `app.rs`, not in route code.

## Testing Strategy

Phase 1 tests should be small and high-value.

### Unit tests

- config defaults
- config environment overrides
- request ID / middleware behavior where practical
- readiness transitions

### Integration-style tests

- `/healthz` returns 200
- `/readyz` returns 200 or 503 correctly
- parse endpoint returns a structured response
- timeout middleware maps to proper HTTP error

### What not to do yet

- no network-heavy end-to-end tests
- no property test explosion
- no benchmark suite for the server crate in phase 1

## SurrealDB Integration

This needs to be part of the spec now, because the server crate should not paint itself into a corner where the only viable future is "one hard-coded Surreal deployment mode."

### What the official sources say

After checking the current official SurrealDB docs and Rust SDK docs:

- SurrealDB supports running as:
  - in-memory
  - file-backed
  - Docker/self-hosted
  - embedded
  - multi-node
  - cloud  
  Source: <https://surrealdb.com/docs>

- `surreal start` supports datastore targets like:
  - `memory`
  - `rocksdb://...`
  - `surrealkv://...`
  - `surrealkv+versioned://...`
  - `tikv://...`  
  Source: <https://surrealdb.com/docs/reference/cli/surrealdb-cli/commands/start>

- A Docker-hosted instance can use RocksDB or SurrealKV internally, but to the Rust application it is simply a remote SurrealDB endpoint. The app does not and should not care whether the remote server stores data using RocksDB or SurrealKV. That storage decision belongs to the server’s own `surreal start ...` command or container configuration.  
  Source: <https://surrealdb.com/docs/reference/cli/surrealdb-cli/commands/start>

- The Rust SDK supports:
  - remote engines over WebSocket and HTTP
  - embedded/local engines via feature flags
  - a dynamic `Surreal<Any>` path for runtime engine selection  
  Sources:
  - <https://docs.rs/surrealdb/latest/surrealdb/engine/remote/index.html>
  - <https://docs.rs/surrealdb/latest/surrealdb/engine/local/index.html>
  - <https://docs.rs/surrealdb/latest/surrealdb/engine/any/index.html>

- The Rust SDK docs explicitly recommend `Surreal<Any>` when you want runtime-decoupled engine choice, while also noting the tradeoff: you get runtime errors if the selected engine was not compiled in.  
  Source: <https://docs.rs/surrealdb/latest/surrealdb/engine/any/index.html>

### Design conclusion

The server crate should support both:

1. embedded SurrealDB for local/dev/single-binary use cases
2. remote SurrealDB for Docker-hosted, self-hosted, multi-node, or cloud use cases

But it should not encode "Docker RocksDB" as a separate client mode.

That distinction matters:

- `ws://db:8000` is a remote mode regardless of whether the server behind it uses RocksDB, SurrealKV, or memory
- `rocksdb://...` is an embedded/local mode inside our process

That is the clean, correct boundary.

### Configuration model

This is where invalid states should become unrepresentable.

I want a strongly typed configuration split like this:

```rust
pub struct SurrealConfig {
    pub ns: Namespace,
    pub db: DatabaseName,
    pub auth: SurrealAuth,
    pub mode: SurrealMode,
}
```

```rust
pub enum SurrealMode {
    Remote(RemoteSurrealConfig),
    Embedded(EmbeddedSurrealConfig),
}
```

```rust
pub struct RemoteSurrealConfig {
    pub endpoint: RemoteEndpoint,
    pub capabilities: RemoteCapabilities,
}
```

```rust
pub enum EmbeddedSurrealConfig {
    Memory(MemoryConfig),
    RocksDb(RocksDbConfig),
    SurrealKv(SurrealKvConfig),
}
```

The important thing is not the exact field names. The important thing is that:

- remote config cannot contain local filesystem paths
- embedded config cannot contain `ws://...` URLs
- RocksDB-specific knobs cannot appear on memory mode
- SurrealKV-specific knobs cannot appear on RocksDB mode

That is the kind of shape Rust is great at.

### Strong types I want

Instead of loose strings everywhere, I want:

- `Namespace`
- `DatabaseName`
- `RemoteEndpoint`
- `StoragePath`
- `SurrealAuth`

Examples:

```rust
pub struct Namespace(SmolStr);
pub struct DatabaseName(SmolStr);
pub struct StoragePath(PathBuf);
```

And:

```rust
pub enum RemoteEndpoint {
    Ws(url::Url),
    Wss(url::Url),
    Http(url::Url),
    Https(url::Url),
}
```

This gives us:

- parse-time validation
- better error messages
- fewer "some string in some env var might be okay"

### Authentication model

I want auth to be typed too:

```rust
pub enum SurrealAuth {
    Root { username: SmolStr, password: SecretString },
    Namespace { username: SmolStr, password: SecretString },
    Database { username: SmolStr, password: SecretString },
    None,
}
```

`None` should only be accepted when the deployment is explicitly unauthenticated, and the startup validation should reject impossible combinations if we decide to constrain that further.

I do not want raw `(String, String)` tuples floating through startup code.

### Embedded engine options

The official docs show meaningful backend-specific differences:

- memory can be versioned and use AOL/snapshots
- RocksDB has `sync`
- SurrealKV has `versioned`, `retention`, and `sync`  
  Source: <https://surrealdb.com/docs/reference/cli/surrealdb-cli/commands/start>

So the Rust config should reflect that structurally:

```rust
pub struct MemoryConfig {
    pub versioned: bool,
    pub retention: Option<Duration>,
    pub aol: MemoryAol,
    pub snapshot: Option<Duration>,
    pub sync: SyncPolicy,
}

pub struct RocksDbConfig {
    pub path: StoragePath,
    pub sync: SyncPolicy,
}

pub struct SurrealKvConfig {
    pub path: StoragePath,
    pub versioned: bool,
    pub retention: Option<Duration>,
    pub sync: SyncPolicy,
}
```

That avoids a giant flat config bag where half the fields are meaningless in a given mode.

### Runtime engine selection strategy

The right internal choice here is to use `Surreal<Any>` behind a small wrapper service.

Why:

- the server crate should not be recompiled just because an operator switches from embedded memory to remote WebSocket
- it aligns with the official `engine::any` guidance
- it lets us keep one app-level `DatabaseService`

But I do **not** want raw endpoint strings to be the only contract.

The plan is:

1. parse config into typed `SurrealMode`
2. convert that typed mode into the correct endpoint string only at the connection boundary
3. connect via `surrealdb::engine::any::connect(...)`

That way:

- the public app config remains safe and typed
- the engine wiring remains flexible

### Cargo feature strategy

This matters a lot because embedded RocksDB can pull in heavy dependencies and the official docs explicitly warn that some engines, especially RocksDB and TiKV, depend on non-Rust libraries and can be painful to build on some machines.  
Source: <https://docs.rs/surrealdb/latest/surrealdb/engine/local/index.html>

So the crate should not enable everything by default.

I want `canary-server` features like:

```toml
[features]
default = ["surreal-remote-ws"]
surreal-remote-ws = ["dep:surrealdb", "surrealdb/protocol-ws"]
surreal-remote-http = ["dep:surrealdb", "surrealdb/protocol-http"]
surreal-embedded-mem = ["dep:surrealdb", "surrealdb/kv-mem"]
surreal-embedded-rocksdb = ["dep:surrealdb", "surrealdb/kv-rocksdb"]
surreal-embedded-surrealkv = ["dep:surrealdb", "surrealdb/kv-surrealkv"]
```

Maybe also an umbrella:

```toml
surreal-all = [
  "surreal-remote-ws",
  "surreal-remote-http",
  "surreal-embedded-mem",
  "surreal-embedded-rocksdb",
  "surreal-embedded-surrealkv",
]
```

This gives us a lovely operational story:

- local development can use `surreal-embedded-mem`
- CI can use `surreal-remote-ws`
- production can use remote or embedded depending on deployment
- we do not force every developer to build RocksDB bindings

### Startup validation

`Surreal<Any>` introduces one real downside: you can choose an engine at runtime that was not compiled in.

So I want a dedicated startup validation step:

```rust
pub fn validate_surreal_mode(mode: &SurrealMode) -> Result<(), ConfigError>
```

It should check, using `cfg!(feature = "...")`, that:

- remote WS config is only accepted if `surreal-remote-ws` is compiled
- remote HTTP config is only accepted if `surreal-remote-http` is compiled
- embedded RocksDB config is only accepted if `surreal-embedded-rocksdb` is compiled
- etc.

This is the key to keeping invalid states out of runtime surprises as much as possible.

It won’t move that failure all the way to the type system, because Cargo features are a compile artifact, but it will move failure to startup with a precise message instead of letting it explode somewhere deep in a handler.

### Proposed database module layout

I want to reserve a dedicated module tree for this:

```text
src/
  db/
    mod.rs
    config.rs
    connect.rs
    error.rs
    service.rs
```

Responsibilities:

- `db/config.rs`
  - typed `SurrealConfig`
  - `SurrealMode`
  - `RemoteEndpoint`
  - auth and backend-specific configs
- `db/connect.rs`
  - mode validation
  - endpoint conversion
  - connection bootstrap
- `db/error.rs`
  - startup and query-facing DB errors
- `db/service.rs`
  - `DatabaseService`
  - small wrapper around `Surreal<Any>`

This keeps Surreal-specific complexity out of `app.rs` and `state.rs`.

### Proposed service shape

Something like:

```rust
#[derive(Clone)]
pub struct DatabaseService {
    db: surrealdb::Surreal<surrealdb::engine::any::Any>,
}
```

With:

- `connect(&SurrealConfig) -> Result<Self, DbError>`
- `health(&self) -> Result<(), DbError>`
- `define_schema(&self) -> Result<(), DbError>` if we decide to bootstrap definitions

I do not want handlers speaking directly to the raw Surreal client.

### Schema/bootstrap policy

SurrealDB’s own Axum example uses startup-time `DEFINE ... IF NOT EXISTS` statements, which is a reasonable baseline for idempotent bootstrap.  
Source: <https://surrealdb.com/docs/languages/rust/frameworks/axum>

For Canary, I want this split:

- phase 1:
  - optional startup bootstrap hook
  - only for foundational definitions if we need them
- later:
  - a dedicated schema/bootstrap story, likely separated from request-serving startup

I do not want `main.rs` to become a migration runner.

### How this changes the crate layout

The updated crate layout should become:

```text
crates/server/
├── Cargo.toml
├── src
│   ├── main.rs
│   ├── lib.rs
│   ├── app.rs
│   ├── config.rs
│   ├── error.rs
│   ├── observability.rs
│   ├── runtime.rs
│   ├── shutdown.rs
│   ├── state.rs
│   ├── db
│   │   ├── mod.rs
│   │   ├── config.rs
│   │   ├── connect.rs
│   │   ├── error.rs
│   │   └── service.rs
│   ├── files
│   │   ├── mod.rs
│   │   ├── error.rs
│   │   ├── meta.rs
│   │   ├── sniff.rs
│   │   ├── stage.rs
│   │   ├── store.rs
│   │   ├── local.rs
│   │   └── service.rs
│   ├── services
│   │   ├── mod.rs
│   │   ├── parser.rs
│   │   └── files.rs
│   └── http
│       ├── mod.rs
│       ├── extract.rs
│       ├── response.rs
│       ├── middleware.rs
│       └── routes
│           ├── mod.rs
│           ├── system.rs
│           └── api
│               ├── mod.rs
│               └── v1
│                   ├── mod.rs
│                   ├── parse.rs
│                   └── files.rs
└── tests
    ├── config_env.rs
    ├── health.rs
    ├── readiness.rs
    └── surreal_config.rs
```

### Updated implementation priorities

For the actual scaffold, I would change the order slightly:

1. crate scaffold
2. `error.rs`
3. `config.rs`
4. `db/config.rs`
5. `runtime.rs`
6. `observability.rs`
7. `shutdown.rs`
8. `db/connect.rs`
9. `db/service.rs`
10. `files/meta.rs`
11. `files/error.rs`
12. `files/sniff.rs`
13. `files/stage.rs`
14. `files/store.rs`
15. `files/local.rs`
16. `files/service.rs`
17. `state.rs`
18. `services/parser.rs`
19. `services/files.rs`
20. `app.rs`
21. `http/...`
22. tests

That sequence keeps the Surreal shape foundational rather than bolted on later.

## Dependency Plan

### Core runtime / server

- `axum`
- `tokio`
- `tower`
- `tower-http`
- `http`
- `serde`
- `serde_json`
- `thiserror`
- `tracing`
- `tracing-subscriber`
- `url`

### Config and ergonomics

- `config`
- `humantime-serde`
- `chrono`
- `human-panic` optional but likely worthwhile for the binary

### Database

- `surrealdb`

But with selective features, not the whole kitchen sink.

### Files

- `axum_typed_multipart`
- `axum-extra`
- `tempfile`
- `tokio-util`
- `mime`
- `mime_guess`
- `infer`
- `sha2`
- `uuid`

Optional later:

- `file-format`
- `object_store`

### Existing workspace crates

- `document-hierarchy`

### Probably not in phase 1

- OTLP exporter crates
- auth crates
- metrics crates
- database crates

## Why Not More Complexity

This server should start with one excellent seam:

- HTTP boundary
- app state
- parser service

That is enough.

If we add DB, retrieval, auth, metrics, and background orchestration up front, we will get a crate that looks "serious" but is actually harder to reason about and easier to degrade.

The right move is to start with a crate that has excellent structure and few moving parts.

## Concrete Implementation Plan

### Phase 1A: Workspace and crate scaffold

1. Add `crates/server`
2. Create `Cargo.toml`
3. Create `src/lib.rs`
4. Create `src/main.rs`
5. Wire it into the workspace automatically via `crates/*`

### Phase 1B: Core infrastructure

1. Implement `error.rs`
2. Implement `config.rs`
3. Implement `runtime.rs`
4. Implement `observability.rs`
5. Implement `shutdown.rs`

### Phase 1C: App assembly

1. Implement `state.rs`
2. Implement `services/parser.rs`
3. Implement `app.rs`

### Phase 1D: HTTP layer

1. Implement `http/mod.rs`
2. Implement `http/middleware.rs`
3. Implement `http/response.rs`
4. Implement `http/routes/system.rs`
5. Implement `http/routes/api/v1/parse.rs`

### Phase 1E: Tests and polish

1. health/readiness tests
2. config env test
3. parse route test
4. clippy
5. rustfmt
6. docs pass over module-level docs

## Strong Opinions I Intend To Keep

- Route builders return `Router<AppState>` and do not call `.with_state(...)` internally.
- `AppState` is cheap to clone and narrows through `FromRef`.
- We use `ServiceBuilder` and keep middleware order explicit.
- Timeout middleware always has a matching error handler.
- Request IDs are wired in the order Tower-HTTP expects.
- `main.rs` stays tiny.
- Domain behavior does not leak into middleware code.
- The crate remains useful as a library, not just a binary.

## Proposed First Deliverable

When I actually scaffold this crate, the first deliverable should be a running binary that:

- boots with config defaults
- starts a Tokio runtime explicitly
- binds an Axum listener
- serves `/healthz`
- serves `/readyz`
- exposes one parser-backed API endpoint
- logs requests with request IDs
- shuts down gracefully on `ctrl-c`

That is the right first slice: small, real, and built on the exact patterns we want to keep.
