# Implementation Notes

## Phase Tracking

### Upload architecture

- Phase 1 implemented:
  - split `UploadRepo` / `BlobMetaRepo` boundaries
  - upload intent state machine
  - status endpoint
  - SSE events endpoint
  - proxy content upload endpoint
  - explicit completion endpoint
  - legacy upload route removal
- Phase 2 implemented:
  - direct presigned `PUT` uploads for direct-capable backends
  - direct multipart part signing, completion, and abort
  - direct upload as the default for S3-compatible backends when server-side checksum verification is not required
  - opportunistic cleanup for expired intents and abandoned objects during upload lifecycle operations
- Phase 3 implemented:
  - durable ready-blob metadata persistence in SurrealDB
  - WebSocket upload event transport on top of the keyed upload watch stream
  - periodic background cleanup sweeps for expired uploads
  - RustFS-backed ignored integration coverage for the S3-compatible contract
- Still pending:
  - any protocol beyond storage-native multipart resumability
  - durable upload-session persistence
  - backend-verified SHA-256 for direct uploads

## Decisions beyond the spec

### SurrealDB defaults

- The crate defaults to `surreal-embedded-mem` and `surreal-remote-ws`.
- This keeps the binary runnable with zero external infrastructure while still supporting remote SurrealDB immediately.

### SurrealDB engine options

- Phase 1 models embedded `memory`, `rocksdb`, and `surrealkv`, but it does not expose every backend-specific tuning knob from `surreal start`.
- The current SDK ergonomics make a fully typed, backend-specific options surface possible, but expensive for a first scaffold.
- I kept the backend mode typed and distinct, but trimmed the per-engine option set to keep the crate focused.

### File metadata persistence

- Ready-blob metadata now persists into SurrealDB through `BlobMetaRepo`, while upload-session state remains in-memory.
- This keeps the upload state machine fast and isolated for now while making reads, listing, and post-completion blob metadata durable across service reconstruction.
- Multipart uploads now persist the incoming `NamedTempFile` into the server's own staging directory before hashing and promotion. This keeps the `tempfile` cleanup owner contained inside the staging layer and ensures the store only ever receives stable staged paths, just like the raw upload path.
- The file subsystem now separates byte storage from metadata listing. Byte persistence, upload-session state, and durable blob metadata are independent collaborators instead of one storage-shaped map pretending to do every job.
- The byte store now uses `object_store` for both local filesystem and S3-compatible backends. This keeps the service surface backend-agnostic and avoids letting `tokio::fs::File` become the public shape of file reads.
- For local development compatibility, the old `files.root` setting still works and now acts as a shorthand for the local backend root. The typed backend model lives under `files.backend`, but the old single-path setup remains pleasant for tests and zero-infra development.
- The `LoadedConfig::load_from_environment_map` test helper still validates the local compatibility path well, but it is not a perfect stand-in for every nested tagged-enum environment override shape. I kept the backend config typed instead of flattening it just to make that helper more permissive.
- Staging is now an explicit file-storage concern in configuration. Local backends default staging to `<root>/.staging`, while S3-compatible backends default it to `data/files/.staging` because proxy uploads still need a local spool directory even when final bytes live in object storage.
- The phase-1 byte store proxies uploads through the server for both local and S3-compatible backends. Presigned direct access is deliberately deferred until metadata persistence and upload-session state are in place.
- Successful object-store writes now treat staged-file cleanup as best-effort. If cleanup fails after the final object has already been persisted, the server logs a warning instead of turning that success into a client-visible 500 and creating a confusing partially successful upload result.
- Multipart staging now hashes and sniffs files with buffered reads instead of `fs::read`, which avoids loading the whole uploaded file into memory just to inspect it.
- The old in-memory `BlobCatalog` has now been replaced by explicit `UploadRepo` and `BlobMetaRepo` boundaries. Upload sessions stay in-memory for now; ready blobs persist through SurrealDB.
- Uploads now have an explicit state machine: `created`, `uploading`, `uploaded`, `ready`, `failed`, `expired`, and `deleted`.
- The new phase-1 upload API is intent-first:
  - `POST /api/v1/files/uploads`
  - `GET /api/v1/files/uploads/{id}`
  - `GET /api/v1/files/uploads/{id}/events`
  - `PUT /api/v1/files/uploads/{id}/content`
  - `POST /api/v1/files/uploads/{id}/complete`
- The upload architecture now chooses between `proxy_put`, `direct_put`, and `direct_multipart` from one typed policy decision in `UploadService`.
- Proxy uploads in the new intent flow stream straight from the Axum request body into the `object_store` writer while hashing and sniffing incrementally. That removes the staging tempfile from the new primary upload path.
- The old `POST /api/v1/files` multipart upload route and `PUT /api/v1/files/raw` route are gone. Upload intents are now the only supported write path.
- Upload events are delivered through a keyed `UploadHub`. SSE remains the primary live-update transport, and WebSockets now sit on top of the same per-upload watch stream for clients that prefer a socket transport.
- Phase 1 introduces a tiny typed upload principal boundary using the `x-canary-actor-id` header. This is deliberately modest and is intended to be replaced by the real auth/session layer later, but it prevents the new upload intent API from being completely ownerless.
- Upload mutation paths now rely on explicit repository transition methods instead of one coarse async mutex. That keeps the workflow honest about its state machine and leaves room for a later durable upload-session repo without rewriting the public upload API again.
- Completion now covers proxied uploads, direct presigned uploads, and multipart flows, including multipart part signing and abort. The remaining integrity gap is backend-verified SHA-256 for direct uploads, which still falls back to `proxy_put` when the client declares a checksum.
- Phase 2 creates S3-compatible multipart sessions lazily on the first `POST /files/uploads/{id}/parts` request instead of during intent creation. That keeps intent creation cheap, keeps the initial upload status honestly `created`, and avoids making the route depend on a live storage round trip before the client has actually decided to upload.
- Direct uploads currently preserve strong checksum semantics by choosing `proxy_put` whenever the client declares a SHA-256 digest. The server does not yet re-download direct objects or use backend-native checksum APIs to verify SHA-256 after a direct upload, so falling back to proxying keeps the public integrity story honest.
- Direct uploads finalize object metadata from object-store `head` plus a bounded `peek` for MIME sniffing. The server records `etag` and `version` when available, but it does not currently persist a verified `hash_sha256` for direct uploads.
- Expired upload cleanup now happens both opportunistically during upload lifecycle operations and through a periodic background sweep in `ServerApplication::run`. The remaining gap is durable upload-session storage, not the existence of a scheduled cleaner.

### File download semantics

- The first download route serves blobs as attachments by default.
- Inline versus attachment policy can be expanded later when the application has a clearer notion of trusted renderable content.

### Parser API

- The parser route accepts raw XML bytes instead of a JSON envelope.
- That keeps the example route honest about real request bodies and avoids wrapping a byte-oriented operation in unnecessary JSON.

### Application testability

- `ServerApplication` exposes a cloneable `router()` accessor.
- This keeps black-box route tests and embedding scenarios straightforward without adding test-only construction paths or requiring socket binding.

### Error representation

- The server boxes the heaviest database-facing error variants at the outer error boundary.
- This keeps `AppError` and `DbError` expressive without letting SurrealDB's large concrete error types leak into every `Result` signature as a layout cost.

### Pagination

- The first pagination slice is cursor-based and uses `BlobId` as the cursor for file listings.
- `BlobId` already exists as the semantic identity type, so introducing a second generic cursor wrapper here would have added ceremony without removing mistakes.
- The default walker is sequential and streaming; there is intentionally no concurrent paginator yet because the current codebase has no bounded page-range use case that would justify it.
- The canonical public shape is now `FileService::list(limit) -> ListBlobs`, with `ListBlobs::page()` for one-page execution and `PageRequest::paginated()` for walking.
- The route layer intentionally goes through the request object instead of constructing `PageWindow` directly, so the docs and the real usage path stay aligned.
- The transport-facing query type is separate from the validated request window. `PageQuery<C>` is serde-friendly for Axum and future Reqwest clients, while `PageWindow<C>` remains the validated internal state.
- The Axum integration lives in `http::extract::Pagination<C, P>` instead of the core module so the shared pagination types stay transport-neutral.
- Pagination policy is now split into two layers:
  - `Pagination<C>` uses the application default policy from config.
  - `Pagination<C, P>` lets a handler opt into an explicit endpoint policy through a tiny marker type.
- The global config-backed policy is now just a default. Endpoint-specific routes like file listing can override it with a tighter bounded policy without giving up the extractor-based handler ergonomics.
- The global policy max is optional. That keeps the app-wide default simple while still allowing expensive endpoints to enforce their own hard caps.
- `BlobId` is now part of the wire shape for pagination instead of being parsed manually from `String`, which keeps the query model consistent between server extraction and future HTTP clients.

### Error handling

- The server now uses one stable Problem Details response shape for handler errors, extractor rejections, fallback 404s, 405s, and middleware failures.
- The wire format is RFC 9457 with `application/problem+json`, but it keeps the best parts of the earlier custom envelope as extension members: `code`, `request_id`, `context`, and `errors`.
- Request ids are attached to the response body through a tiny request-context middleware instead of being threaded through every handler manually, and they are also promoted into the RFC `instance` field as `urn:canary:request:<id>`.
- The request context now carries Tower HTTP's `RequestId` type instead of flattening it to `String` immediately. The conversion to the response-facing `request_id` text and the RFC `instance` value happens at the response boundary, which keeps the request pipeline more typed and avoids ad hoc string formatting in middleware.
- The parser route now treats malformed document payloads as validation failures rather than internal server errors.
- The server keeps human-safe client messages separate from internal causes. Internal sources are logged, but they are not serialized back to clients.
- `miette` is now used for internal diagnostics and top-level process reporting, not for the HTTP wire format. The server keeps a small Axum-facing `AppError` for JSON responses and a separate `ServerError` for startup/runtime failures.
- `thiserror` remains the base derive for typed errors, and `miette::Diagnostic` is layered on top of the config, database, file, and server diagnostic enums instead of replacing them with `miette::Report`.
- The binary installs a `miette` report handler and returns `miette::Result<()>` from `main()`, which makes startup failures much nicer without leaking diagnostic concerns into handler signatures.

### Upload refactor

- The old `POST /api/v1/files` and `PUT /api/v1/files/raw` compatibility upload routes are gone. The only supported write path is now upload intent creation plus the upload session lifecycle.
- `stage.rs` and the tempfile-based compatibility staging path were removed with those legacy routes. Uploads now flow through either direct S3-compatible access or streamed proxy writes.
- `FileService` is now just a façade over two focused services:
  - `UploadService` owns upload intent and lifecycle orchestration.
  - `BlobService` owns ready-blob reads and listing.
- The old single `BlobRepo` abstraction has been split conceptually into `UploadRepo` and `BlobMetaRepo`. The current in-memory implementation still shares one inner state container, but the service layer now talks to the two responsibilities separately.
- The upload-session repo is now explicitly in-memory-only, while ready-blob metadata uses a dedicated Surreal-backed `BlobMetaRepo`. Reconstructing `FileService` against the same database preserves ready blob metadata without resurrecting stale upload sessions.
- The old storage pairing of `BlobStore` plus optional `DirectStore` was replaced with a matched backend enum:
  - `Backend::Local(LocalBackend)`
  - `Backend::S3(S3Backend)`
- That backend enum keeps byte persistence and direct-upload capability structurally aligned, so invalid combinations like “local bytes plus S3 direct upload” are no longer representable.
- Upload sessions are now strategy-specific values instead of one broad struct with optional multipart fields. The current model uses `UploadSession::{Proxy, DirectPut, Multipart}` with shared data extracted into `UploadCommon`.
- Multipart session identity is now represented explicitly with `MultipartUploadId` and `PartNumber` newtypes instead of raw strings and integers at subsystem boundaries.
- Route DTOs such as `CreatedUpload`, `UploadTarget`, and `UploadRecord` are now built in the HTTP route layer instead of inside the upload service. The service returns semantic access plans and session state, not route strings.
- Upload events now use a keyed `watch`-based `UploadHub` instead of one global broadcast bus. Subscribers watch one upload id at a time and receive the latest session snapshot plus subsequent lifecycle changes.
- Direct single-shot uploads now support access refresh through `POST /api/v1/files/uploads/{id}/access`. That closes the gap where an expired presigned `PUT` URL could not previously be renewed.
- Upload route body limits now come from `files.uploads.max_bytes`. The separate HTTP raw/multipart upload caps were removed so there is one authoritative upload size policy.
- The in-memory upload repo now owns explicit transition methods like `begin_upload`, `attach_multipart`, `record_parts`, `mark_uploaded`, `mark_ready`, and terminal state markers. That let the coarse global async mutex disappear without replacing it with another subsystem-wide lock.
- Durable blob metadata now lives behind `SurrealBlobMetaRepo`, so listing and blob lookups no longer depend on the lifetime of one server process. The remaining durable-state gap is upload sessions themselves, which are intentionally still in-memory until their persistence model is designed deliberately.
