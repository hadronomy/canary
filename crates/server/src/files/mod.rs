//! File uploads, blob metadata, and object-storage access.
//!
//! This module owns the server-side half of Canary's file pipeline. It does not
//! act as a byte proxy. Instead, it issues constrained upload access, waits for
//! object storage to verify the upload, inspects the staged object, and only
//! then promotes it into the ready namespace that the rest of the system can
//! treat as durable application data.
//!
//! The result is a deliberately narrow contract:
//!
//! - uploads always land in object storage first
//! - ready blobs are published only after validation succeeds
//! - download access is derived from ready metadata, not from staging objects
//! - integrity data reflects what was actually verified, not what would be
//!   convenient to claim
//!
//! # High-level shape
//!
//! The public entry point is [`service::FileService`], which is a small facade
//! over two focused services:
//!
//! - [`service::UploadService`] manages upload intents, access refresh, multipart
//!   coordination, completion, expiry, and lifecycle events.
//! - [`service::BlobService`] handles ready-blob reads, metadata lookup, listing,
//!   and signed download access.
//!
//! The rest of the module is split along the same boundaries:
//!
//! - [`upload`] models upload sessions, upload modes, and client-facing access
//!   contracts.
//! - [`meta`] defines blob identity, checksum metadata, media classification, and
//!   the difference between staging keys and ready keys.
//! - [`store`] wraps the configured storage backend and exposes the operations
//!   the rest of the module is allowed to perform.
//! - [`direct`] contains the S3-compatible signing and multipart logic used by
//!   direct uploads.
//! - [`repo`] separates upload-session state from durable ready-blob metadata.
//! - [`sniff`] inspects object bytes and turns them into policy-aware media
//!   decisions.
//! - [`events`] publishes keyed upload lifecycle updates for SSE and WebSocket
//!   consumers.
//! - [`list`] provides the paginated ready-blob listing flow.
//!
//! # Lifecycle
//!
//! Uploads move through two object namespaces:
//!
//! - staging objects live under `staging/upload/<id>/object`
//! - ready objects live under `ready/blob/<id>/original`
//!
//! That split is more than naming. It is the boundary that keeps unfinished or
//! rejected uploads out of the serving path.
//!
//! A typical upload goes through these steps:
//!
//! 1. The caller creates an upload intent through [`service::UploadService`].
//! 2. The service chooses a direct upload strategy:
//!    - [`upload::UploadMode::DirectPut`] for smaller objects
//!    - [`upload::UploadMode::DirectMultipart`] for larger ones
//! 3. Object storage receives the upload at the session's staging key and
//!    verifies the required checksum contract.
//! 4. Completion causes Canary to inspect the staged object, validate size and
//!    checksum, classify its media, and derive the final serving policy.
//! 5. The validated object is promoted into its ready key.
//! 6. Only after promotion succeeds is the blob written to the ready metadata
//!    repository and the upload marked [`upload::UploadState::Ready`].
//!
//! The important invariant is simple:
//!
//! > Nothing is a real blob until it has left staging.
//!
//! # Integrity model
//!
//! The module treats integrity as part of the storage contract rather than as a
//! best-effort embellishment.
//!
//! - Direct single-part uploads require a declared SHA-256 digest. The server
//!   presigns access with `x-amz-checksum-sha256`, and completion succeeds only
//!   if object storage reports the same full-object checksum back.
//! - Direct multipart uploads use a storage-native CRC64/NVME full-object
//!   checksum contract. Part uploads carry per-part checksum headers, and
//!   completion requires the final checksum that storage verifies for the whole
//!   object.
//!
//! Blob metadata stores this as [`meta::BlobChecksum`], which records the
//! algorithm, checksum kind, and the verifier that actually established it.
//! That keeps the API honest across single-part and multipart uploads instead of
//! flattening everything into a pretend "one hash fits all" story.
//!
//! # Media validation
//!
//! File type handling is split into observation and decision making.
//!
//! [`sniff`] inspects a bounded sample of bytes and produces media observations
//! such as:
//!
//! - what the client declared
//! - what the sample strongly or heuristically suggests
//! - whether the sample is complete or only a prefix
//!
//! [`meta::MediaProfile`] then turns that observation into a serving decision.
//! This keeps media policy explicit and leaves room for different upload
//! purposes to evolve without turning MIME detection into a grab bag of special
//! cases.
//!
//! # Serving
//!
//! Ready blobs are not streamed through the server. [`service::BlobService`]
//! resolves a ready blob into signed object-storage access and the HTTP layer
//! redirects callers to that URL. This keeps the application out of the hot
//! byte path while preserving server-side control over:
//!
//! - which key may be read
//! - which `Content-Type` should be served
//! - whether the object should be treated as an attachment
//!
//! Staging objects are never part of that flow.
//!
//! # Backend expectations
//!
//! The production upload API assumes a direct-capable object store. In practice
//! that means the S3-compatible backend in [`direct`]. The local backend remains
//! useful for tests and development scaffolding, but it does not pretend to be a
//! full direct-upload target and will reject public upload-intent creation.
//!
//! # Design notes
//!
//! A few constraints are worth preserving as the module evolves:
//!
//! - transport concerns stay in the route layer; the service layer returns
//!   semantic access plans and state transitions
//! - upload-session state and ready-blob metadata remain distinct concerns
//! - storage metadata is aligned during promotion, not by mutating a served
//!   object in place after the fact
//! - download access is always derived from ready metadata
//!
//! Those rules keep the subsystem pleasant to reason about even as multipart
//! behavior, media policy, or backend capabilities grow more sophisticated.
//!
//! # TODO
//!
//! - Evaluate issuing temporary object-storage credentials for constrained
//!   upload sessions when presigned URLs become too limiting, while preserving
//!   the current checksum contract and staging-to-ready lifecycle guarantees.

pub mod direct;
pub mod error;
pub mod events;
pub mod list;
pub mod meta;
pub mod repo;
pub mod service;
pub mod sniff;
pub mod store;
pub mod upload;
