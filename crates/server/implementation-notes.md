# Implementation Notes

## Phase Tracking

### Upload architecture

- Phase 1 implemented:
  - split `UploadRepo` / `BlobMetaRepo` boundaries
  - upload intent state machine
  - status endpoint
  - SSE events endpoint
  - explicit completion endpoint
  - legacy upload route removal
- Phase 2 implemented:
  - direct presigned `PUT` uploads
  - direct multipart part signing, completion, and abort
  - S3-compatible object storage as the only file backend
  - opportunistic cleanup for expired intents and abandoned objects during upload lifecycle operations
- Phase 3 implemented:
  - durable ready-blob metadata persistence in SurrealDB
  - WebSocket upload event transport on top of the keyed upload watch stream
  - periodic background cleanup sweeps for expired uploads
  - RustFS-backed ignored integration coverage for the S3-compatible contract
- Still pending:
  - any protocol beyond storage-native multipart resumability
  - durable upload-session persistence

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
- The file subsystem now separates byte storage from metadata listing. Byte persistence, upload-session state, and durable blob metadata are independent collaborators instead of one storage-shaped map pretending to do every job.
- File storage now requires S3-compatible object storage. The local filesystem backend, `files.root` compatibility setting, and proxy upload path are gone.
- Configuration names the required store directly under `files.storage`; there is no backend selector for a capability the service cannot use.
- Successful promotion treats staged-object cleanup as best-effort. If cleanup fails after the ready object has been persisted, the server logs a warning instead of turning success into a confusing client-visible failure.
- The old in-memory `BlobCatalog` has now been replaced by explicit `UploadRepo` and `BlobMetaRepo` boundaries. Upload sessions stay in-memory for now; ready blobs persist through SurrealDB.
- Uploads now have an explicit state machine: `created`, `uploading`, `uploaded`, `ready`, `failed`, `expired`, and `deleted`.
- The new phase-1 upload API is intent-first:
  - `POST /api/v1/files/uploads`
  - `GET /api/v1/files/uploads/{id}`
  - `GET /api/v1/files/uploads/{id}/events`
  - `POST /api/v1/files/uploads/{id}/complete`
- The upload architecture chooses between `direct_put` and `direct_multipart` from one typed policy decision in `UploadService`.
- The old `POST /api/v1/files` multipart upload route and `PUT /api/v1/files/raw` route are gone. Upload intents are now the only supported write path.
- Upload events are delivered through a keyed `UploadHub`. SSE remains the primary live-update transport, and WebSockets now sit on top of the same per-upload watch stream for clients that prefer a socket transport.
- Phase 1 introduces a tiny typed upload principal boundary using the `x-canary-actor-id` header. This is deliberately modest and is intended to be replaced by the real auth/session layer later, but it prevents the new upload intent API from being completely ownerless.
- Upload mutation paths now rely on explicit repository transition methods instead of one coarse async mutex. That keeps the workflow honest about its state machine and leaves room for a later durable upload-session repo without rewriting the public upload API again.
- Completion covers direct presigned uploads and multipart flows, including multipart part signing and abort.
- Phase 2 creates S3-compatible multipart sessions lazily on the first `POST /files/uploads/{id}/parts` request instead of during intent creation. That keeps intent creation cheap, keeps the initial upload status honestly `created`, and avoids making the route depend on a live storage round trip before the client has actually decided to upload.
- Direct uploads bind checksums into the storage-native contract. Single-request uploads require SHA-256; multipart uploads use CRC64/NVME with full-object semantics.
- Direct uploads finalize object metadata from object-store `head` plus a bounded `peek` for MIME sniffing. The server records `etag`, `version`, and storage-verified checksum metadata when available.
- Upload completion now treats the sniffed/effective media type as authoritative for serving and storage metadata. The original declared type is still preserved for audit/debugging, but successful finalization rewrites S3-compatible object `Content-Type` metadata when the backend object would otherwise drift from Canary's authoritative type.
- The media policy is intentionally conservative for active/renderable content. Safe passive mismatches like `application/octet-stream` plus a sniffed PNG are normalized to the sniffed type, while suspicious mismatches involving HTML, XML, SVG, or script-like types are rejected with `upload_content_type_mismatch`.
- The old one-shot MIME resolver has been split conceptually into two steps:
  - media inspection records what the client declared, what the server detected, where the detection came from, and how confident that detector was
  - media policy decides whether that observation is acceptable for the upload profile and what the authoritative stored type should be
- Uploads currently use one explicit media profile, `attachment`. That profile is permissive for passive content and opaque binaries, but it rejects undeclared or unverified browser-active content and derives a serving policy separately from the stored type.
- Media inspection now tracks sample completeness explicitly as `empty`, `complete`, or `prefix`. That matters for formats like JSON where a valid large document often cannot be fully parsed from the first sniff window.
- MIME comparison now uses MIME essence instead of full parameter equality. That avoids false security failures for equivalent types like `text/plain` versus `text/plain; charset=utf-8`.
- Serving behavior is now modeled as a first-class policy instead of implicitly mirroring the authoritative media type. The current attachment profile serves passive media with their effective type, but downgrades active media to `application/octet-stream` if they are ever admitted in a future profile.
- Download responses now include `X-Content-Type-Options: nosniff` so the HTTP edge matches the stricter media-classification model.
- Classification now returns an upload decision instead of only `Result<BlobKind, FileError>`. The current decisions are:
  - `accept` for fully verified classifications
  - `review` for accepted uploads whose media type was inferred from an incomplete prefix and still needs fuller validation later
  - `reject` for policy failures
- `BlobKind` now carries its validation state so accepted-but-incomplete classifications stay visible after persistence. That keeps large JSON prefixes or other heuristic passive detections from silently collapsing into a fully verified MIME label.
- The S3 direct backend now sets an AWS behavior version for both ambient and static credential paths. Without that, static-credential startup panicked during client construction even though the ambient path worked.
- Multipart status refresh now only re-lists backend parts while a multipart upload is still in `created` or `uploading`. Once the upload reaches `ready`, the backend multipart session may already be gone, so continuing to refresh it turned a successful upload into a spurious 500 on the status endpoint.
- The S3-compatible validation setup now includes a RustFS compose stack and a working `rustfs-init` helper that creates the validation bucket idempotently through the AWS CLI container.
- During live RustFS validation, the rewritten object `Content-Type` was observable immediately through Canary and after a short delay through `head-object` on the RustFS side. The rewrite does land correctly, but RustFS metadata visibility was not strictly synchronous on the first zero-delay check.
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

- The old `POST /api/v1/files` and `PUT /api/v1/files/raw` compatibility upload routes are gone. The only supported write path is now upload intent creation plus the direct upload session lifecycle.
- `stage.rs` and the tempfile-based compatibility staging path were removed with those legacy routes. The public upload API no longer proxies request bodies through the server at all.
- `FileService` is now just a façade over two focused services:
  - `UploadService` owns upload intent and lifecycle orchestration.
  - `BlobService` owns ready-blob reads and listing.
- The old single `BlobRepo` abstraction has been split conceptually into `UploadRepo` and `BlobMetaRepo`. The current in-memory implementation still shares one inner state container, but the service layer now talks to the two responsibilities separately.
- The upload-session repo is now explicitly in-memory-only, while ready-blob metadata uses a dedicated Surreal-backed `BlobMetaRepo`. Reconstructing `FileService` against the same database preserves ready blob metadata without resurrecting stale upload sessions.
- The old backend enum was replaced with one `ObjectStorage` collaborator. Byte
  access and S3-compatible direct signing now arrive together, so a file
  service without the capabilities required by its public API cannot be
  constructed.
- Upload sessions are now strategy-specific values instead of one broad struct with optional multipart fields. The current model uses `UploadSession::{DirectPut, Multipart}` with shared data extracted into `UploadCommon`.
- Multipart session identity is now represented explicitly with `MultipartUploadId` and `PartNumber` newtypes instead of raw strings and integers at subsystem boundaries.
- Route DTOs such as `CreatedUpload`, `UploadTarget`, and `UploadRecord` are now built in the HTTP route layer instead of inside the upload service. The service returns semantic access plans and session state, not route strings.
- Upload events now use a keyed `watch`-based `UploadHub` instead of one global broadcast bus. Subscribers watch one upload id at a time and receive the latest session snapshot plus subsequent lifecycle changes.
- Direct single-shot uploads now support access refresh through `POST /api/v1/files/uploads/{id}/access`. That closes the gap where an expired presigned `PUT` URL could not previously be renewed.
- Small direct uploads now require a declared SHA-256 digest. The server presigns `PUT` access with `x-amz-checksum-sha256` and only accepts completion if object storage reports the same full-object checksum back.
- Multipart uploads now use a storage-native checksum contract instead of ETags alone. The server requires `CRC64NVME` with `FULL_OBJECT` semantics for the multipart session, signs part uploads with per-part checksum headers, and only accepts completion when object storage reports the same full-object checksum.
- Upload route body limits now come from `files.uploads.max_bytes`. The separate HTTP raw/multipart upload caps were removed so there is one authoritative upload size policy.
- The in-memory upload repo now owns explicit transition methods like `begin_upload`, `attach_multipart`, `record_parts`, `mark_uploaded`, `mark_ready`, and terminal state markers. That let the coarse global async mutex disappear without replacing it with another subsystem-wide lock.
- Durable blob metadata now lives behind `SurrealBlobMetaRepo`, so listing and blob lookups no longer depend on the lifetime of one server process. The remaining durable-state gap is upload sessions themselves, which are intentionally still in-memory until their persistence model is designed deliberately.
- Upload keys are now split by lifecycle:
  - `UploadSession` owns a `StagingKey`
  - `StoredBlob` owns a `ReadyKey`
- Uploads always land under `staging/upload/<id>/object` first. Completion promotes the validated object into `ready/blob/<id>/original`, deletes the staging object, and only then marks the blob ready in metadata.
- The old direct-upload-only `sync_content_type` repair step is gone. Promotion is now the single place where S3-compatible backends canonicalize stored `Content-Type`, which keeps the bucket structure and metadata policy aligned.
- Blob integrity metadata now uses one canonical `checksum` field instead of the narrower `hash_sha256`. Completed uploads only surface integrity values that were actually verified, either by storage (`sha256`, `crc64_nvme`) or by a future first-class verifier with equivalent guarantees.
- Downloads no longer proxy object bytes through the app server. The blob route now redirects to a short-lived presigned `GET` for the ready object, with response content type and attachment disposition derived from Canary's validated blob metadata.
