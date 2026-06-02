#![doc(alias = "uploads")]
#![doc(alias = "blobs")]

//! File uploads, blob metadata, and signed object-storage access.
//!
//! This module is the server-side contract for Canary's file pipeline. It
//! answers three closely related questions:
//!
//! - **Who is allowed to upload?**
//! - **When does an uploaded object become a real blob?**
//! - **How is a ready blob served without reopening the staging path?**
//!
//! The answer is intentionally conservative. Canary does **not** proxy upload
//! bodies through the application server, and it does **not** treat an object
//! as a blob just because storage accepted some bytes. Uploads land in
//! *staging*, storage verifies the checksum contract, Canary inspects the
//! object, and only then does the object move into the *ready* namespace and
//! become durable application data.[^ready]
//!
//! <div class="warning">
//!
//! A staged object is **never** part of the serving path.
//!
//! If an upload has not been validated, promoted into the ready namespace, and
//! persisted in the ready metadata store, it must remain invisible to normal
//! blob reads.
//!
//! </div>
//!
//! # At a glance
//!
//! | Area | Primary items | Responsibility |
//! | --- | --- | --- |
//! | Service layer | [`service::FileService`], [`service::UploadService`], [`service::BlobService`] | Orchestrates upload lifecycle, ready-blob access, and listing |
//! | Upload model | [`upload::UploadSession`], [`upload::UploadMode`], [`upload::UploadAccess`] | Describes what a client may do next and which state an upload is in |
//! | Identity | [`id::FileId`], [`id::UploadId`] | Keeps ready blobs and upload sessions distinct at the type level |
//! | Blob model | [`meta::StoredBlob`], [`meta::BlobChecksum`], [`meta::ReadyKey`] | Defines the durable shape of a ready blob |
//! | Storage boundary | [`store`], [`direct`] | Talks to the configured object store and signs direct access |
//! | Metadata boundary | [`repo::UploadRepo`], [`repo::BlobMetaRepo`] | Separates upload-session state from durable ready-blob metadata |
//! | Media policy | [`sniff`], [`meta::MediaProfile`] | Turns observed bytes into an explicit serving decision |
//! | Eventing | [`events`] | Publishes keyed upload lifecycle updates for SSE and WebSocket consumers |
//!
//! # The happy path
//!
//! A typical upload looks like this:
//!
//! 1. A caller creates an upload intent through [`service::UploadService`].
//! 2. The service chooses a direct strategy:
//!    - [`upload::UploadMode::DirectPut`] for smaller objects
//!    - [`upload::UploadMode::DirectMultipart`] for larger ones
//! 3. The client uploads directly into the session's [`meta::StagingKey`].
//! 4. Object storage verifies the required checksum contract.
//! 5. Completion causes Canary to inspect the staged object, validate its size
//!    and checksum, and classify its media.
//! 6. The validated object is promoted into its [`meta::ReadyKey`].
//! 7. Only after promotion succeeds does Canary persist a [`meta::StoredBlob`]
//!    and mark the upload [`upload::UploadState::Ready`].
//!
//! That separation is not cosmetic. It is the mechanism that keeps an
//! unfinished upload from quietly becoming application data.
//!
//! # Example
//!
//! The application service is intentionally small at the call site. The caller
//! asks for an intent, then reacts to the direct access contract that comes
//! back.
//!
//! ```no_run
//! # use canary_server::files::upload::UploadDraft;
//! # use canary_server::{
//! #     BlobName, BlobSize, FileError, Sha256Digest, UploadAccess, UploadPurpose, UploadService,
//! # };
//! # async fn demo(uploads: UploadService) -> Result<(), FileError> {
//! let intent = uploads
//!     .create_intent(UploadDraft {
//!         actor: canary_server::ActorId::new("alice")?,
//!         purpose: UploadPurpose::attachment(),
//!         name: Some(BlobName::new("report.pdf")?),
//!         declared_type: Some("application/pdf".parse().expect("valid mime")),
//!         declared_size: BlobSize::new(128 * 1024),
//!         sha256: Some(Sha256Digest::from_hex(
//!             "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
//!         )?),
//!     })
//!     .await?;
//!
//! match intent.access {
//!     UploadAccess::DirectPut(put) => {
//!         let _url = put.url;
//!         let _headers = put.headers;
//!         let _checksum = put.checksum;
//!     }
//!     UploadAccess::Multipart(mp) => {
//!         let _part_size = mp.part_size_bytes;
//!         let _max_parts = mp.max_parts;
//!         let _checksum = mp.checksum;
//!     }
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # Integrity model
//!
//! Integrity metadata in this module is meant to be a *statement of fact*, not
//! a convenience field.
//!
//! - Direct single-part uploads require a declared SHA-256 digest. Canary
//!   presigns access with `x-amz-checksum-sha256`, and completion succeeds only
//!   if object storage reports the same **full-object** checksum back.
//! - Direct multipart uploads use a storage-native CRC64/NVME contract. Part
//!   uploads carry per-part checksums, and completion succeeds only if storage
//!   reports the same **full-object** checksum for the assembled object.
//!
//! The result is stored as [`meta::BlobChecksum`], which records the checksum
//! algorithm, the checksum kind, and the verifier that actually established the
//! value. That keeps the API honest across direct `PUT` and multipart uploads
//! without flattening very different integrity stories into one vague field.
//!
//! # Media validation
//!
//! File type handling is split cleanly between *observation* and *policy*.
//!
//! [`sniff`] inspects a bounded sample and records things such as:
//!
//! - what the client declared
//! - what the bytes strongly or heuristically suggest
//! - whether the sample was complete or only a prefix
//!
//! [`meta::MediaProfile`] then decides what that observation means for serving.
//! This keeps media rules explicit and leaves room for different upload purposes
//! to evolve without turning MIME detection into a hidden policy engine.
//!
//! # Serving
//!
//! Ready blobs are not streamed through the application server. Instead,
//! [`service::BlobService`] resolves a ready blob into signed object-storage
//! access and the HTTP layer redirects callers to that URL.
//!
//! That preserves server-side control over:
//!
//! - which ready key may be read
//! - which `Content-Type` should be served
//! - whether the object should be presented as an attachment
//!
//! while keeping the application out of the hot byte path.
//!
//! # Storage and metadata boundaries
//!
//! Two splits make this module much easier to reason about:
//!
//! - [`repo::UploadRepo`] owns upload-session state.
//! - [`repo::BlobMetaRepo`] owns durable ready-blob metadata.
//!
//! and:
//!
//! - [`meta::StagingKey`] belongs to an upload session.
//! - [`meta::ReadyKey`] belongs to a stored blob.
//!
//! Those are small distinctions, but they prevent the system from collapsing
//! "bytes were written somewhere" into "a blob exists now."
//!
//! # Storage expectations
//!
//! The upload API requires S3-compatible object storage. There is no local
//! filesystem fallback: development and tests use the same direct-storage
//! contract as production.
//!
//! # Module guide
//!
//! If you are orienting yourself in the implementation, these are the best
//! starting points:
//!
//! - Start with [`service`] for the public orchestration story.
//! - Read [`upload`] next to understand the session state machine and client
//!   access contracts.
//! - Read [`meta`] for the durable blob model, checksum types, and key
//!   boundaries.
//! - Follow [`store`] and [`direct`] when you need to understand storage
//!   behavior or presigned access generation.
//! - Read [`repo`] when tracking what survives process restarts and what does
//!   not.
//!
//! # TODO
//!
//! - Evaluate issuing temporary object-storage credentials for constrained
//!   upload sessions when presigned URLs become too limiting, while preserving
//!   the current checksum contract and staging-to-ready lifecycle guarantees.
//!
//! [^ready]: In this module, *ready* means more than "the bytes exist." It
//!   means the object has been validated, promoted, and published in durable
//!   ready-blob metadata.

pub mod direct;
pub mod error;
pub mod events;
pub mod id;
pub mod list;
pub mod meta;
pub mod repo;
pub mod service;
pub mod sniff;
pub mod store;
pub mod upload;
