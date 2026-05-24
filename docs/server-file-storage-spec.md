# Server File Storage Spec

## Purpose

Design a first-class file subsystem for `canary-server` that:

- presents one stable HTTP API to clients
- works well as a proxy between clients and S3-compatible storage
- preserves delightful upload and download ergonomics
- keeps storage backend details out of the public API
- supports both local development and S3-compatible production deployments

## Conclusions

The best shape is a hybrid design:

- the server owns the public `/files` contract
- the server may proxy uploads and downloads
- the server may later issue presigned direct access
- bytes live in an object store
- metadata lives in the application domain

This means the server should not expose bucket names, object keys, or filesystem paths as the client contract. Those are backend details.

## Public API direction

The long-term public API should become session-based:

1. `POST /api/v1/files/uploads`
   - create an upload session
   - return either a proxy upload target or direct presigned upload instructions
2. `PUT /api/v1/files/uploads/{id}/content`
   - proxy raw-body upload
3. `POST /api/v1/files/uploads/{id}/complete`
   - finalize and verify direct uploads
4. `GET /api/v1/files/{id}`
   - proxied download with range and conditional support
5. `HEAD /api/v1/files/{id}`
   - metadata-oriented download probe
6. `GET /api/v1/files/{id}/meta`
   - metadata only

However, the current implementation phase will preserve the existing routes:

- `POST /api/v1/files`
- `PUT /api/v1/files/raw`
- `GET /api/v1/files/{id}`
- `GET /api/v1/files/{id}/meta`

while refactoring the internals so those routes already sit on the right storage architecture.

## Storage architecture

The storage system should be split into two concerns:

1. byte storage
2. blob metadata and listing

### Byte storage

Byte storage is responsible for:

- writing staged uploads
- opening download streams
- optional direct signed access

This should be backend-agnostic and support:

- local filesystem
- S3-compatible object stores

### Metadata/catalog

Metadata is responsible for:

- mapping `BlobId` to backend storage keys
- stable listing and cursor pagination
- storing file names, sizes, hashes, media types, and upload state

The long-term target is a database-backed catalog. The implementation phase in this patch will keep an in-memory catalog, but it will be explicitly separated so a SurrealDB-backed catalog can replace it later without rewriting the storage API again.

## Core Rust design

### Typed backend config

`FilesConfig` should evolve to:

- `backend: FileBackendConfig`
- `uploads: BlobConfig`

where `FileBackendConfig` is:

- `Local(LocalFileConfig)`
- `S3(S3FileConfig)`

`S3FileConfig` should include:

- `bucket`
- `region`
- `endpoint: Option<Url>`
- `prefix: Option<String>`
- `path_style: bool`
- `allow_http: bool`
- credentials mode

### Service boundary

`FileService` remains the public server-facing API, but it should stop owning a concrete local store.

It should own:

- a byte store backend
- a metadata catalog
- upload config

### Byte store trait

The byte store abstraction should be shaped around operations, not filesystem handles:

- `put(staged) -> StoredBlob`
- `open(blob) -> BlobRead`
- `head(blob) -> BlobHead`
- `sign_download(blob, expiry) -> SignedBlobAccess`
- `sign_upload(blob, expiry) -> SignedBlobAccess`

Not every backend or phase must implement signing immediately, but the abstraction should leave room for it.

### Read abstraction

Downloads should not be modeled as `tokio::fs::File`.

Instead the service should work with a backend-neutral streamed read type that can back:

- local files
- S3-compatible object reads

and later range-aware and conditional reads.

## Implementation phase in this patch

This patch will land the foundational phase:

1. introduce a typed file backend config
2. split byte storage from metadata listing
3. make `FileService` backend-agnostic
4. implement:
   - local byte store backend
   - S3-compatible object-store-backed byte store backend
5. keep the existing HTTP routes working
6. keep metadata in an in-memory catalog for now
7. keep uploads proxied through the server for now

This deliberately does **not** yet implement:

- upload session endpoints
- direct presigned upload or download routes
- SurrealDB-backed blob metadata persistence
- range/conditional passthrough on downloads

Those are phase-2 concerns once the byte-store boundary is stable.

## Why this phase is still the right move

This phase is the smallest meaningful architecture change that:

- makes S3-compatible storage first-class
- keeps the current HTTP API working
- removes filesystem assumptions from the service boundary
- sets up direct signed access as an additive next step rather than another rewrite

## High-signal references

- `object_store` crate docs and source
- `AmazonS3Builder`
- `Signer`
- `GetOptions`
- AWS S3 multipart upload guidance
- AWS presigned URL guidance
