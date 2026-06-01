# Server Upload Architecture Spec

## Goal

Replace the current tempfile-heavy upload path with a production-grade upload flow that:

- authorizes before any bytes are accepted
- prefers direct-to-object-storage uploads for large files
- keeps the app server responsible for intent creation, policy, metadata, and finalization
- streams any proxied bytes without buffering whole files in memory
- enforces hard size limits and predictable failure behavior
- preserves the existing RFC 9457 error contract

This spec is intentionally small and pragmatic. It picks the next architecture this codebase should grow into, not the final upload platform for every future use case.

## Current State

The current server stack is:

- Axum `0.8.9`
- Tower HTTP middleware with request IDs, tracing, panic handling, and global `DefaultBodyLimit`
- `object_store`-based byte storage, with local and S3-compatible backends
- RFC 9457 Problem Details responses through `AppError`

Current upload behavior:

- `POST /api/v1/files/uploads` creates upload intents
- `PUT /api/v1/files/uploads/{id}/content` handles streamed proxy uploads
- `POST /api/v1/files/uploads/{id}/parts` signs multipart direct-upload parts for direct-capable backends
- `POST /api/v1/files/uploads/{id}/access` refreshes direct single-shot access for direct-capable backends
- `POST /api/v1/files/uploads/{id}/complete` finalizes uploads
- `POST /api/v1/files/uploads/{id}/abort` aborts uploads
- there is no real auth/session layer yet, so ownership currently hangs off the typed `x-canary-actor-id` principal boundary
- ready-blob metadata now persists through SurrealDB, while upload-session state is still in-memory

This means the current code proves the file-service shape, but it is not yet the right upload architecture for S3-compatible storage.

## High-Signal Conclusions

### 1. Direct upload is the right default for large files

The strongest modern pattern is the UploadThing-style flow:

- authorize and validate an upload intent on the app server
- return a direct upload target
- receive a completion callback or explicit completion request
- persist metadata only after the server confirms the upload

This avoids paying app-server ingress/egress costs, avoids server-side multipart parsing for large files, and keeps storage credentials off the client.

### 2. Server-proxied upload should be the fallback, not the default

Proxying bytes is still useful when:

- the client is not browser-capable
- the product needs immediate server-side inspection or transformation
- the backend is local/dev storage
- the deployment cannot yet issue signed direct uploads

When proxying is required, the server should stream body chunks directly to the destination and enforce a hard limit. It should not call `bytes().await` on full file bodies and should not create tempfiles unless there is a product reason such as quarantine or offline scanning.

### 3. Direct multipart upload should be the resumability primitive

This system should not bet on `tus` as its primary resumable contract.

For an object-storage-backed service, the more natural primitive is:

- single-request direct PUT for smaller uploads
- direct multipart upload for larger uploads

Direct multipart upload already gives the service the most important resumability properties:

- retry failed parts independently
- upload parts out of one larger logical file
- resume after interruption by asking the server which parts are already accepted
- complete or abort the upload explicitly

That means the service can offer a modern resumable experience without introducing a second upload protocol on day one.

If a future product requirement demands a universal resumable protocol across heterogeneous backends and clients, `tus` can still be considered later. It should not shape the first version of this system.

### 4. Real-time completion should use SSE first, with WebSockets as a sibling transport

Upload progress and completion notifications are part of a polished upload API.

The clean default is:

- polling via a status endpoint for correctness and recovery
- SSE for live status and completion updates
- WebSockets over the same event model when the client prefers a socket transport

SSE is the better default because upload progress is mostly server-to-client notification, not a bidirectional messaging problem.

### 5. `object_store` is good for bytes, but not enough for upload presigning policy

`object_store` is still the right storage abstraction for:

- server-side reads
- server-side proxied writes
- range and conditional downloads
- backend portability across local and S3-compatible storage

But its signing surface is intentionally simple. For high-quality direct uploads, the server should be able to constrain more than just method/path/expiry. In practice that means:

- keep `object_store` for byte IO
- use backend-specific signing for direct upload intents when a richer presign surface is needed

For S3-compatible backends, that points toward AWS SigV4-compatible presigning rather than forcing all signing through the generic `object_store::Signer` API.

## Selected Architecture

### Decision

The next upload architecture should be:

- **intent-first**
- **direct-to-object-storage by default**
- **proxy-by-exception**
- **metadata-backed**
- **streaming whenever the app handles bytes**

### Flow Summary

1. Client asks the server to create an upload intent.
2. Server authenticates, authorizes, validates policy, allocates a blob id and storage key, and persists an upload record in state `created`.
3. Server returns one of three upload strategies:
   - `direct_put` for smaller S3-compatible direct upload
   - `direct_multipart` for larger resumable S3-compatible upload
   - `proxy_put` for server-mediated streaming upload
4. Client uploads bytes.
5. Client polls status or subscribes to upload events.
6. Client calls a completion endpoint.
7. Server verifies the stored object, computes or confirms final metadata, marks the upload `ready`, and exposes it through the existing file routes.

This keeps storage policy out of handlers and gives the client a delightful, predictable API.

## Public API Shape

### 1. Create intent

`POST /api/v1/files/uploads`

Request body:

```json
{
  "name": "report.pdf",
  "content_type": "application/pdf",
  "size_bytes": 1048576,
  "sha256": "optional-hex-checksum",
  "purpose": "attachment"
}
```

Response body for a small direct upload:

```json
{
  "id": "blob-id",
  "status": "created",
  "expires_at": "2026-05-24T12:34:56Z",
  "upload": {
    "kind": "direct_put",
    "method": "PUT",
    "url": "https://...",
    "headers": {
      "content-type": "application/pdf"
    }
  }
}
```

Response body for a large resumable upload:

```json
{
  "id": "blob-id",
  "status": "created",
  "expires_at": "2026-05-24T12:34:56Z",
  "upload": {
    "kind": "direct_multipart",
    "part_size_bytes": 8388608,
    "max_parts": 10000,
    "complete_url": "/api/v1/files/uploads/blob-id/complete",
    "abort_url": "/api/v1/files/uploads/blob-id/abort"
  }
}
```

Response body for a proxy upload:

```json
{
  "id": "blob-id",
  "status": "created",
  "expires_at": "2026-05-24T12:34:56Z",
  "upload": {
    "kind": "proxy_put",
    "method": "PUT",
    "url": "/api/v1/files/uploads/blob-id/content",
    "max_bytes": 1048576
  }
}
```

### 2. Upload status

`GET /api/v1/files/uploads/{id}`

Response body:

```json
{
  "id": "blob-id",
  "status": "uploading",
  "strategy": "direct_multipart",
  "size_bytes": 1048576,
  "uploaded_parts": [1, 2, 3],
  "expires_at": "2026-05-24T12:34:56Z"
}
```

This endpoint is the correctness anchor for recovery and resumability. A client that reconnects should be able to call it and continue from the current authoritative state.

### 3. Upload events

`GET /api/v1/files/uploads/{id}/events`

This endpoint should expose SSE as the primary live-update transport.

Example event types:

- `upload.created`
- `upload.uploading`
- `upload.part_accepted`
- `upload.completed`
- `upload.failed`
- `upload.expired`

WebSockets should use the same event vocabulary. They should not become the only real-time path.

### 4. Direct multipart part signing

`POST /api/v1/files/uploads/{id}/parts`

Request body:

```json
{
  "parts": [1, 2, 3]
}
```

Response body:

```json
{
  "parts": [
    {
      "number": 1,
      "method": "PUT",
      "url": "https://...",
      "headers": {}
    }
  ]
}
```

This lets the client request presigned part uploads lazily instead of forcing all parts to be minted up front.

### 5. Proxy upload content

`PUT /api/v1/files/uploads/{id}/content`

This endpoint exists only for the proxy strategy. It should accept a raw request body and stream it directly into the destination storage writer.

It should not accept multipart for the main upload API. The intent-based flow is the only supported write contract.

### 6. Complete upload

`POST /api/v1/files/uploads/{id}/complete`

Request body:

```json
{
  "etag": "optional-provider-etag",
  "sha256": "optional-hex-checksum"
}
```

The server verifies the upload and returns the canonical blob metadata.

For direct multipart uploads, the completion request should also carry the accepted parts and provider ETags if the backend requires them.

### 7. Abort upload

`POST /api/v1/files/uploads/{id}/abort`

This endpoint transitions the upload into an aborted or failed terminal state and cleans up any backend-side partial upload state.

### 8. Existing file routes

These remain the read surface:

- `GET /api/v1/files/{id}`
- `GET /api/v1/files/{id}/meta`
- `GET /api/v1/files`

The legacy `POST /api/v1/files` multipart route and `PUT /api/v1/files/raw` route should not survive the new flow. The intent-based API should remain the only supported write surface.

## Storage Model

### Byte storage

Bytes live in the configured object storage backend:

- local filesystem in development
- S3-compatible storage in production

### Metadata storage

Metadata should not live only in process memory.

The service should introduce a real metadata repository boundary, for example:

- `UploadRepo`
- `BlobMetaRepo`

The current implementation already uses a durable Surreal-backed blob metadata repository. Upload-session durability remains a later phase.

### Upload record

Uploads need an explicit state machine:

- `created`
- `uploading`
- `uploaded`
- `ready`
- `failed`
- `expired`
- `deleted`

Each record should carry at least:

- blob id
- owner or actor id
- purpose
- backend kind
- storage key
- declared content type
- declared size
- optional declared checksum
- detected content type
- actual size
- optional etag
- optional multipart upload id
- uploaded parts summary
- state
- created_at
- expires_at
- completed_at

## Validation Rules

### Authorization

The server must authenticate before creating an intent.

This codebase does not yet have a real auth/session extractor, so upload intents should be blocked on introducing one small authenticated principal boundary. The upload architecture should be designed around ownership now, not retrofitted later.

### Type validation

- do not trust client-provided MIME type alone
- do not trust file extension alone
- treat declared content type as a hint
- sniff the first bytes during verification
- compare extension, declared type, and sniffed type against policy

### Size validation

Enforce size in three places:

1. at intent creation, against the requested `size_bytes`
2. at the transport boundary, using hard body limits for proxied uploads
3. at completion, by checking the stored object’s actual size

### Checksum validation

If the client provides a checksum:

- persist it on the intent
- verify it during completion
- fail the upload if it does not match

If a direct upload strategy can safely bind checksum headers into the presigned request, do so. Otherwise, server-side verification at completion is still required.

### Header and CORS contract

The upload intent response must tell the client exactly which headers are required on direct uploads.

For direct uploads, the server should treat these headers as part of the contract:

- `Content-Type`
- `Content-Length` when enforceable
- checksum headers when used

For browser clients, S3-compatible CORS must explicitly allow:

- `PUT`
- `HEAD`
- `GET`
- the request headers required by the signed upload
- the response headers the client needs to read, especially `ETag`

The API should not assume that a presigned URL is enough by itself. The required headers and browser CORS policy are part of the upload design.

## Limits

### Direct uploads

Direct uploads should be the default for large files.

The initial direct-upload policy should be:

- presigned single-request PUT for smaller files
- presigned direct multipart upload for larger files
- short expiry, for example 5 to 15 minutes
- explicit maximum size per upload purpose

### Proxy uploads

Proxy uploads must have strict limits:

- route-level `RequestBodyLimitLayer`, not only `DefaultBodyLimit`
- per-intent size check while streaming
- request timeout already enforced by the global middleware stack

The current `DefaultBodyLimit::disable()` on `PUT /files/raw` should not survive into the new primary upload endpoint without a dedicated `RequestBodyLimitLayer`.

### Multipart

The main upload architecture should not depend on unbounded multipart parsing.

- it should only exist behind a deliberate product requirement
- it should use explicit route-level limits
- it should stream field chunks if it ever re-enters the hot path
- it should not be the preferred large-file API

## Direct vs Proxy Strategy

### Direct upload strategy

Use direct upload when:

- backend is S3-compatible
- client can perform a direct PUT
- no immediate in-band transformation is required

Use `direct_put` when:

- the file is below the multipart threshold

Use `direct_multipart` when:

- the file is above the multipart threshold
- resumability or retry-by-part is desirable

### Proxy upload strategy

Use proxy upload when:

- backend is local filesystem
- client cannot use direct storage uploads
- the product requires bytes to pass through the app
- the upload must be inspected before it is committed

The server decides the strategy. The client should not need to guess it.

## Verification and Completion

Completion should be explicit.

On `POST /uploads/{id}/complete`, the server should:

1. load the intent
2. verify ownership and state
3. `HEAD` the object
4. verify actual size
5. read a small initial byte range if sniffing is needed
6. verify checksum if declared
7. verify part state if this was a multipart upload
8. persist final metadata
9. transition state to `ready`

No upload should become publicly readable only because bytes appeared in the bucket.

For direct multipart uploads, the server should also support:

- incomplete upload discovery through `GET /uploads/{id}`
- aborting stale uploads through `POST /uploads/{id}/abort`
- backend lifecycle cleanup for incomplete multipart uploads

## Error Behavior

Keep the current RFC 9457 problem-details contract.

Add upload-specific problem codes such as:

- `upload_unauthorized`
- `upload_forbidden`
- `upload_not_found`
- `upload_expired`
- `upload_invalid_state`
- `upload_too_large`
- `upload_invalid_type`
- `upload_checksum_mismatch`
- `upload_incomplete`

Rules:

- do not leak storage credentials or internal signing details
- keep validation errors actionable
- keep internal storage failures generic on the wire and rich in tracing

## Cleanup Strategy

### Expired intents

Upload intents should expire automatically if not completed within a short TTL.

### Orphaned objects

Objects uploaded through expired or failed intents should be deleted by a cleanup job.

### Multipart leftovers

- incomplete multipart uploads must be aborted
- bucket lifecycle rules should also clean abandoned parts

### Temporary local files

The new primary architecture should avoid tempfiles entirely on the happy path.

Local staging should remain only for:

- explicit proxy/quarantine workflows
- narrowly justified workflows that truly need a local spool

## Testing Plan

### Unit tests

- upload policy validation by purpose
- size limit resolution
- content type allow/deny rules
- state transitions

### Route tests

- unauthenticated intent creation fails
- intent creation succeeds with valid metadata
- status fetch returns authoritative upload state
- SSE endpoint emits upload lifecycle events
- proxy upload rejects oversized bodies with `413`
- completion fails on invalid state
- completion fails on checksum mismatch
- completion fails on invalid detected type
- successful direct or proxy upload completes and returns final metadata
- multipart direct upload can resume after partial completion
- multipart direct upload can abort cleanly

### Integration tests

- local backend round-trip
- RustFS-backed S3-compatible direct upload flow
- RustFS-backed direct multipart upload flow
- RustFS-backed browser-style CORS + signed header compatibility smoke test

The RustFS path is especially important because this architecture is explicitly targeting the S3-compatible contract, not only the local backend.

## Phased Implementation Plan

### Implemented so far

- upload and blob metadata repository boundaries
- upload intents and metadata state machine
- `POST /files/uploads`
- `GET /files/uploads/{id}`
- `GET /files/uploads/{id}/events` with SSE
- `POST /files/uploads/{id}/access`
- `POST /files/uploads/{id}/parts`
- `POST /files/uploads/{id}/complete`
- `POST /files/uploads/{id}/abort`
- `PUT /files/uploads/{id}/content` as proxy fallback
- direct presigned S3-compatible `PUT` uploads
- direct multipart upload orchestration
- direct upload as the default for S3-compatible backends
- legacy upload route removal
- durable ready-blob metadata persistence in SurrealDB
- WebSocket upload event transport over the same upload event model
- periodic background cleanup sweeps for expired uploads
- ignored RustFS-backed S3-compatible integration coverage

### Still pending

- add durable upload-session persistence
- add backend-verified SHA-256 for direct uploads
- consider a generic resumable protocol only if product needs clearly exceed storage-native multipart resumability

## Source Notes

This design is informed primarily by:

- Axum multipart and body-limit docs
- Tower HTTP request body limit docs
- `object_store` S3 and signer docs
- AWS presigned URL and multipart upload guidance
- Cloudflare R2 presigned upload and CORS guidance
- UploadThing’s route, auth, and completion flow
- SSE transport guidance
- OWASP file upload guidance
