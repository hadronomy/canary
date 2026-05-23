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
