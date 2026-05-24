# Implementation Notes

## Decisions beyond the spec

### SurrealDB defaults

- The crate defaults to `surreal-embedded-mem` and `surreal-remote-ws`.
- This keeps the binary runnable with zero external infrastructure while still supporting remote SurrealDB immediately.

### SurrealDB engine options

- Phase 1 models embedded `memory`, `rocksdb`, and `surrealkv`, but it does not expose every backend-specific tuning knob from `surreal start`.
- The current SDK ergonomics make a fully typed, backend-specific options surface possible, but expensive for a first scaffold.
- I kept the backend mode typed and distinct, but trimmed the per-engine option set to keep the crate focused.

### File metadata persistence

- Phase 1 uses a real local blob store and keeps blob metadata in an in-memory index behind the local store.
- The database service is live and ready, but file metadata is not yet persisted into SurrealDB.
- This avoids freezing a Surreal schema too early while still giving the server a fully working file pipeline.
- Multipart uploads now persist the incoming `NamedTempFile` into the server's own staging directory before hashing and promotion. This keeps the `tempfile` cleanup owner contained inside the staging layer and ensures the store only ever receives stable staged paths, just like the raw upload path.

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
