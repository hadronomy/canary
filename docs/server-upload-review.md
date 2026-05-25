# Server Upload System Review

## Verdict

Current score: **6.3 / 10**

The upload system is no longer a random collection of handlers, which is good. It has:

- a real upload-intent model
- explicit upload states
- streamed proxy uploads
- direct presigned uploads
- direct multipart orchestration
- SSE status delivery
- an RFC 9457 error model

But it also has a set of architectural seams that are still too soft for a production-grade storage service:

- the new upload model is not the only truth
- one service owns too many jobs
- the storage and metadata boundaries are still conceptually wrong
- transport concerns leak into the domain
- the durability story is still scaffold-level

This document captures the current issues and the plan to fix them.

## Implementation Status

The review below is preserved as the critique that drove the redesign. Since it was written, the following items have been implemented:

- legacy write routes removed
- `FileService` split into `UploadService` and `BlobService`
- HTTP DTO assembly moved to the route layer
- `UploadRepo` and `BlobMetaRepo` split
- keyed `watch`-based upload events replaced the global broadcast model
- direct upload access refresh added
- one upload policy now drives route body limits
- the coarse global upload mutex was removed in favor of explicit repo transitions
- durable ready-blob metadata now persists through `SurrealBlobMetaRepo`

Still intentionally pending:

- durable upload-session persistence
- backend-verified SHA-256 for direct uploads

## Current Shape

Today the upload subsystem collaborates like this:

- HTTP routes in `crates/server/src/http/routes/api/v1/files.rs` call `FileService`
- `FileService` in `crates/server/src/files/service.rs` orchestrates almost everything
- `BlobRepo` in `crates/server/src/files/repo.rs` stores upload session state and also acts as the ready-blob index
- `BlobStore` in `crates/server/src/files/store.rs` handles object bytes and also direct-upload orchestration
- `DirectStore` in `crates/server/src/files/direct.rs` speaks AWS SDK presign and multipart APIs
- `UploadTarget`, `CreatedUpload`, and `UploadRecord` in `crates/server/src/files/upload.rs` are API-facing DTOs, but they are produced inside the service layer

That collaboration graph is coherent enough to work, but the boundaries are not yet clean.

## Findings

### 1. The new upload-intent model is not actually the only truth

Files:

- `crates/server/src/http/routes/api/v1/files.rs:34`
- `crates/server/src/files/service.rs:289`
- `crates/server/src/files/service.rs:309`
- `crates/server/src/files/upload.rs:24`

Problem:

- `POST /files` and `PUT /files/raw` still exist as compatibility upload routes
- those routes do not use `UploadActor`
- they create uploads using `ActorId::system()`
- that bypasses ownership and most of the new session-oriented policy model

Why it is bad:

- there are now two public truths for uploads
- one is session-based and actor-aware
- the other is an unauthenticated side door
- that makes the whole model less trustworthy

### 2. `FileService` is a god object

File:

- `crates/server/src/files/service.rs:30`

Problem:

`FileService` currently owns:

- upload intent creation
- upload policy selection
- ownership checks
- status lookup
- SSE publication
- proxy streaming writes
- multipart orchestration
- completion logic for three strategies
- cleanup of expired uploads and orphaned objects
- listing and download reads
- HTTP target URL generation

Why it is bad:

- too much behavior is centralized
- it is harder to test true domain boundaries
- the type is already absorbing unrelated concerns
- every future upload capability will make this worse

### 3. The domain leaks HTTP concerns

Files:

- `crates/server/src/files/service.rs:58`
- `crates/server/src/files/service.rs:378`
- `crates/server/src/files/upload.rs:187`

Problem:

- `create_intent` returns `CreatedUpload` directly
- `target` builds concrete route URLs like `/api/v1/files/uploads/{id}/...`
- `UploadTarget` carries method/url/headers response shape inside the upload domain

Why it is bad:

- the service layer should decide what access is granted, not how the HTTP router names endpoints
- route changes should not force service redesign
- this weakens reuse and makes tests more transport-shaped than domain-shaped

### 4. `BlobRepo` combines two different aggregates

Files:

- `crates/server/src/files/repo.rs:14`
- `crates/server/src/files/repo.rs:69`
- `crates/server/src/files/repo.rs:79`

Problem:

The same repository abstraction handles:

- upload sessions
- ready blob metadata
- ready-blob listing

The in-memory implementation derives ready blobs by filtering upload session records.

Why it is bad:

- upload sessions and published blob metadata are not the same thing
- ready-blob listing should not be a filtered view over upload sessions forever
- this will become awkward as soon as durable metadata, ownership policies, or search evolve

### 5. `BlobStore` mixes byte IO with direct-upload orchestration

Files:

- `crates/server/src/files/store.rs:53`
- `crates/server/src/files/store.rs:163`

Problem:

`BlobStore` currently does two jobs:

- byte storage and reads
- direct-upload orchestration, including presign and multipart lifecycle

Why it is bad:

- direct delegated access is a different capability from byte persistence
- the store boundary is no longer “just storage”
- lower layers are being taught upload-session semantics

### 6. S3 configuration is duplicated in two stacks

Files:

- `crates/server/src/files/store.rs:72`
- `crates/server/src/files/direct.rs:75`

Problem:

- `object_store` S3 config is built in one place
- AWS SDK S3 config is built separately in another
- endpoint, region, credentials, path-style behavior are duplicated

Why it is bad:

- drift risk
- harder future configuration changes
- more room for proxy and direct paths to behave differently by accident

### 7. A coarse global mutex is enforcing correctness

Files:

- `crates/server/src/files/service.rs:34`
- `crates/server/src/files/service.rs:69`
- `crates/server/src/files/service.rs:127`
- `crates/server/src/files/service.rs:175`
- `crates/server/src/files/service.rs:237`
- `crates/server/src/files/service.rs:262`

Problem:

The subsystem uses a single `Arc<Mutex<()>>` to serialize most mutating work.

Why it is bad:

- it throttles throughput
- it hides missing transition semantics in the repository
- the model is correct today partly because nothing meaningful can race
- that is acceptable scaffolding, not a lasting architecture

### 8. Direct `PUT` access cannot be refreshed

Files:

- `crates/server/src/files/service.rs:389`
- `crates/server/src/http/routes/api/v1/files.rs:133`

Problem:

- direct `PUT` upload targets are created at intent creation time
- if the presigned URL expires before upload, there is no dedicated refresh path
- multipart has `/parts`; direct `PUT` has no equivalent access renewal

Why it is bad:

- browser and mobile clients routinely need retry-safe access refresh
- this is a real product hole, not just a missing convenience

### 9. The upload state model is muddy across strategies

File:

- `crates/server/src/files/upload.rs:72`

Problem:

`UploadState` is shared across:

- proxy uploads
- direct single-shot uploads
- direct multipart uploads

But some states mean different things in different strategies.

Examples:

- `Uploaded` mostly means “proxy bytes reached storage”
- direct uploads often jump to `Ready`
- `Uploading` can mean “multipart session exists”, not necessarily active transfer

Why it is bad:

- the state machine is harder to reason about
- events and status semantics become fuzzier than they should be

### 10. The event system is too global for its semantics

Files:

- `crates/server/src/files/events.rs:5`
- `crates/server/src/http/routes/api/v1/files.rs:143`

Problem:

- all upload events go through one global broadcast channel
- every SSE consumer subscribes to all events
- each route handler filters by upload id afterward

Why it is bad:

- unnecessary work
- weaker semantics than a per-upload watch model
- less clear behavior under load or lag

### 11. Direct upload integrity is still second-class

Files:

- `crates/server/src/files/service.rs:474`
- `crates/server/src/files/service.rs:588`
- `crates/server/src/files/meta.rs:167`

Problem:

- declared SHA-256 currently forces the service onto `ProxyPut`
- direct completion only verifies size, `head`, and sniffed media
- direct uploads do not currently produce a verified SHA-256 hash

Why it is bad:

- the current behavior is honest, but the capability gap is real
- direct upload remains less trustworthy for integrity-sensitive clients

### 12. Upload limits are split across two policy planes

Files:

- `crates/server/src/config.rs:207`
- `crates/server/src/config.rs:441`
- `crates/server/src/http/routes/api/v1/files.rs:30`
- `crates/server/src/files/service.rs:415`

Problem:

- route-level body caps are configured in `HttpConfig`
- upload business policy is configured in `BlobConfig`
- both influence whether an upload is accepted

Why it is bad:

- easy to misconfigure
- harder to reason about the actual upload contract
- the server can reject a request in two different policy layers

### 13. `stage.rs` is now dead-end compatibility scaffolding

Files:

- `crates/server/src/files/stage.rs:16`
- `crates/server/src/files/stage.rs:56`

Problem:

- tempfile-based staging still exists for compatibility routes
- the new streamed/direct architecture does not really depend on it

Why it is bad:

- this is not wrong on its own
- it is wrong if it remains in the system after the legacy routes are removed

## What Better External Designs Suggest

The strongest external patterns all point in roughly the same direction:

- Axum expects explicit body limits and careful multipart handling rather than accidental buffering
- object storage libraries treat multipart upload as a distinct lifecycle
- S3-compatible systems use multipart as the practical resumability primitive
- public storage services separate metadata from object bytes
- modern upload products separate authorization and policy from the byte path

High-signal references:

- Axum multipart docs: <https://docs.rs/axum/latest/axum/extract/multipart/struct.Multipart.html>
- Axum default body limit docs: <https://docs.rs/axum/latest/axum/extract/struct.DefaultBodyLimit.html>
- Tower HTTP request body limit docs: <https://docs.rs/tower-http/latest/tower_http/limit/struct.RequestBodyLimitLayer.html>
- `object_store::MultipartUpload`: <https://docs.rs/object_store/latest/object_store/trait.MultipartUpload.html>
- AWS S3 multipart upload overview: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html>
- AWS SDK for Rust presigned URLs: <https://docs.aws.amazon.com/sdk-for-rust/latest/dg/presigned-urls.html>
- Cloudflare R2 presigned URLs: <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- UploadThing file routes: <https://docs.uploadthing.com/file-routes>
- UploadThing uploading flow: <https://docs.uploadthing.com/uploading-files>
- Supabase storage schema: <https://supabase.com/docs/guides/storage/schema/design>
- OWASP file upload cheat sheet: <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>

## Fix Plan

### Issue 1. Make the upload API have one truth

Plan:

- remove `POST /files` and `PUT /files/raw`
- remove the service methods that exist only to support those paths
- remove any route-level tests that preserve those legacy flows
- keep `UploadActor` or real auth as the only public write path

Recommended first move:

- cut the routes and their supporting code in the same change
- keep the upload-intent API as the sole supported write path

### Issue 2. Split `FileService` into focused services

Plan:

- introduce `UploadService`
  - create intent
  - refresh status
  - stream proxy body
  - sign direct access
  - complete
  - abort
  - publish upload events
- introduce `BlobService`
  - head
  - get/download
  - list
- keep a small façade only if ergonomics really benefit from it

Recommended first move:

- split reads/listing out first
- then move upload intent and completion out of `FileService`

### Issue 3. Remove HTTP route knowledge from the domain

Plan:

- stop having the service produce `CreatedUpload` directly
- introduce domain-facing access types, for example:
  - `UploadAccess::Proxy`
  - `UploadAccess::DirectPut`
  - `UploadAccess::DirectMultipart`
- let the route layer map those to `CreatedUpload` and route URLs

Recommended first move:

- replace `target()` string construction with a route-layer adapter
- keep `UploadTarget` as an API DTO, not a domain type

### Issue 4. Split upload sessions from ready-blob metadata

Plan:

- replace the current single `BlobRepo` with:
  - `UploadRepo`
  - `BlobMetaRepo`
- make upload completion publish or persist a ready blob record separately
- make listing come from `BlobMetaRepo`, not from filtering upload sessions

Recommended first move:

- keep one in-memory implementation if needed
- still expose two traits and two conceptual stores

### Issue 5. Split byte storage from direct delegated access

Plan:

- make `ByteStore` own:
  - `begin_write`
  - `put`
  - `open`
  - `head`
  - `peek`
  - `delete`
- make `DirectUploadBackend` own:
  - `sign_put`
  - `create_multipart`
  - `sign_parts`
  - `list_parts`
  - `complete_multipart`
  - `abort_multipart`

Recommended first move:

- keep both backed by the same S3 config for now
- make them separate fields in the upload service

### Issue 6. Unify S3 configuration assembly

Plan:

- introduce one typed S3 backend config builder/helper
- derive both:
  - `object_store` config
  - AWS SDK client config
  from the same normalized configuration

Recommended first move:

- create one internal `S3Backend` or `S3Context` constructor
- make both storage and direct-upload pieces depend on it

### Issue 7. Replace the coarse mutex with explicit transition semantics

Plan:

- move correctness into the repository boundary
- add transition-oriented methods such as:
  - `begin_upload(id, expected_state)`
  - `mark_uploaded(id, blob)`
  - `mark_ready(id, blob)`
  - `mark_failed(id)`
  - `mark_deleted(id)`
- for durable storage, use optimistic concurrency or compare-and-set style updates

Recommended first move:

- remove the single mutex only after repo transition APIs exist
- do not just swap one lock for more locks

### Issue 8. Add access refresh for direct single-shot uploads

Plan:

- add a refresh endpoint such as:
  - `POST /api/v1/files/uploads/{id}/access`
  or
  - `POST /api/v1/files/uploads/{id}/refresh`
- only allow refresh for still-active direct uploads
- return a renewed `DirectPut` access plan

Recommended first move:

- keep multipart `/parts` as-is
- add the equivalent refresh path for `DirectPut`

### Issue 9. Refine the state model

Plan:

- keep the state machine simple, but make the semantics clearer
- likely state set:
  - `Created`
  - `Uploading`
  - `Uploaded`
  - `Ready`
  - `Failed`
  - `Expired`
  - `Deleted`
- but reinterpret or split transitions by strategy more deliberately

Possible refinement:

- keep the enum
- make strategy-specific transition rules explicit in the upload service
- document which strategies can ever enter `Uploaded`

Recommended first move:

- keep the enum for now
- document strategy/state matrix
- tighten transition helpers so invalid combinations are impossible through the service

### Issue 10. Replace the global broadcast model

Plan:

- introduce keyed event streams per upload id
- likely use:
  - `watch` for latest-state semantics, or
  - keyed broadcast channels if event history really matters

Recommended first move:

- use `watch<UploadRecord>` keyed by upload id for SSE
- publish typed lifecycle events internally if richer eventing is still useful

### Issue 11. Improve direct-upload integrity

Plan:

- keep the current honest proxy fallback for declared SHA-256 until the direct path can verify correctly
- later options:
  - require object-store checksum headers the server can verify on completion
  - compute checksums asynchronously after completion
  - store checksum verification status separately

Recommended first move:

- keep current behavior
- make the integrity limitation explicit in the public contract
- design direct checksum verification as a dedicated later phase instead of half-adding it

### Issue 12. Consolidate upload policy

Plan:

- keep transport-level hard caps
- but derive them from one upload policy model
- separate:
  - transport hard limit
  - upload contract limit
  only when they genuinely differ

Recommended first move:

- make `BlobConfig` the authoritative upload policy
- let route layers read their caps from that policy unless there is a compelling route-specific exception

### Issue 13. Remove compatibility staging entirely

Plan:

- remove `stage.rs`
- remove tempfile-based multipart staging that only exists for compatibility routes
- ensure the upload architecture depends only on:
  - direct object-storage uploads
  - proxy streaming uploads
  - upload intents and completion

Recommended first move:

- delete the compatibility upload path once the old routes are removed

## Recommended Execution Order

### Phase A. Establish one public truth

- remove compatibility upload routes
- remove the service code and tempfile staging that exist only to support them
- ensure all upload capabilities flow only through upload intents

### Phase B. Split the core boundaries

- introduce `UploadService`
- introduce `BlobService`
- split `BlobRepo` into `UploadRepo` and `BlobMetaRepo`
- split `BlobStore` into `ByteStore` and `DirectUploadBackend`

### Phase C. Remove transport leakage

- move API DTO creation to the route layer
- stop generating route URLs inside the service layer
- keep the domain types semantic and transport-neutral

### Phase D. Replace scaffold synchronization

- add transition-oriented repository APIs
- remove the coarse global mutex
- preserve correctness through explicit state transitions

### Phase E. Close product gaps

- add direct `PUT` access refresh
- replace global event broadcast with keyed watch/event streams
- consolidate upload limit policy

### Phase F. Finish production hardening

- durable metadata persistence
- background cleanup
- stronger integrity story for direct uploads
- RustFS-backed integration coverage as the primary validation target for the S3-compatible contract

## Backend Position

The target architecture should remain **S3-compatible by contract**.

That means:

- no RustFS-specific service abstraction
- no RustFS-specific route model
- no RustFS-specific upload state machine
- no RustFS-specific direct-upload API

Instead:

- `S3FileConfig` remains the backend configuration model
- direct uploads continue to be designed around S3-compatible presign and multipart semantics
- RustFS becomes the primary real backend used to validate that contract in integration testing and operational review

If RustFS is fully S3-compatible, that is the best outcome:

- the architecture stays clean
- backend choice stays in configuration and testing
- the application does not grow provider-specific types unless a real incompatibility forces them

## Recommended First Refactor Slice

The best first slice is:

1. keep behavior the same
2. split `FileService` into `UploadService` and `BlobService`
3. move `CreatedUpload` and `UploadTarget` assembly out of the service layer
4. split the repository abstraction into upload sessions vs ready blob metadata

Why this first:

- it fixes the most important structural problems without forcing a whole protocol rewrite
- it makes later durability and cleanup work much easier
- it reduces the chance that phase 3 adds more behavior to the current god object

## Target End State

The system should evolve toward:

- **one public upload truth**
- **one upload service**
- **one blob read service**
- **one upload repository**
- **one blob metadata repository**
- **one byte store**
- **one direct-upload backend**
- **one upload policy model**

That is the version that will feel like a real Rust system rather than a successful accumulation of working code paths.

## Leveraging Rust To Make Invalid States Unrepresentable

The current design is already better than a stringly pile of handlers, but it still leaves too many invalid combinations representable in ordinary structs.

The next architectural pass should use Rust’s type system more aggressively in a few specific places.

### 1. Use a closed backend enum for matched backend capabilities

Instead of modeling storage as:

- one byte store
- one optional direct-upload backend

use one matched backend aggregate:

```rust
enum Backend {
    Local(LocalBackend),
    S3(S3Backend),
}

struct LocalBackend {
    bytes: LocalByteStore,
}

struct S3Backend {
    bytes: S3ByteStore,
    direct: S3DirectBackend,
}
```

This makes the following invalid states impossible:

- local bytes paired with S3 direct-upload support
- S3 bytes without S3 direct-upload support
- any other accidental backend mismatch

This is the most important type-level fix because it removes an entire class of wiring bugs structurally.

### 2. Model upload sessions as strategy-specific variants

The current `UploadMeta` shape is too broad and uses optional fields to represent strategy differences.

Instead of one maximal bag of fields, model the session as:

```rust
enum UploadSession {
    Proxy(ProxyUpload),
    DirectPut(DirectPutUpload),
    Multipart(MultipartUpload),
}
```

with shared data moved into:

```rust
struct UploadCommon {
    id: BlobId,
    actor: ActorId,
    purpose: UploadPurpose,
    key: BlobKey,
    name: Option<BlobName>,
    declared_type: Option<Mime>,
    declared_size: BlobSize,
    declared_hash: Option<BlobHash>,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}
```

and strategy-specific structs holding only what they actually need.

That makes these invalid states impossible:

- multipart uploads without multipart upload ids
- proxy uploads with multipart part state
- direct `PUT` uploads carrying multipart-only data
- strategy-specific fields existing on the wrong upload kind

### 3. Replace optional multipart fields with required typed fields

Multipart-specific data should not be optional fields hanging off the generic upload session.

Instead:

```rust
struct MultipartUpload {
    common: UploadCommon,
    state: MultipartState,
    upload_id: MultipartUploadId,
    parts: BTreeSet<PartNumber>,
}
```

That makes “multipart upload with no upload id” unrepresentable.

### 4. Make completion commands strategy-specific

The current completion command shape is too loose because it allows unrelated fields to appear together.

Prefer:

```rust
enum CompleteCmd {
    Proxy(CompleteProxy),
    DirectPut(CompleteDirectPut),
    Multipart(CompleteMultipart),
}
```

or even separate service methods per strategy.

This removes nonsense combinations such as:

- direct `PUT` completion carrying multipart part lists
- multipart completion without multipart parts
- proxy completion carrying direct-upload-only fields

### 5. Introduce stronger protocol newtypes

The codebase already benefits from `BlobId`, `BlobHash`, and `BlobName`.

Extend that pattern to upload protocol values:

```rust
struct MultipartUploadId(SmolStr);
struct PartNumber(u16);
struct Etag(SmolStr);
struct PresignedUrl(Url);
```

These newtypes should validate on construction and replace raw `String` and `u16` usage at subsystem boundaries.

### 6. Keep constructors private and transitions explicit

Many invalid states remain possible simply because broad structs can be assembled directly.

Prefer:

- private fields
- validated constructors
- explicit transition methods

For example:

```rust
impl MultipartUpload {
    fn new(common: UploadCommon, upload_id: MultipartUploadId) -> Self { ... }

    fn record_parts(self, parts: BTreeSet<PartNumber>) -> Self { ... }
}
```

That keeps the only legal construction paths inside the domain model.

### 7. Use typestate selectively, not dogmatically

Typestate is useful for short-lived in-memory workflows, but it should not be forced onto every persisted upload record.

Good use:

- request builders
- transition helpers
- internal orchestration values that are not stored long-term

Avoid overusing it for:

- persisted DB rows
- broad cross-process lifecycle state

The main persisted model should still be enums and validated structs, not a maze of generic markers.

### 8. Encode backend capability structurally

Code that needs direct upload support should not depend on:

- a byte store
- plus an optional sibling object

It should depend on a backend shape that structurally guarantees the capability exists.

That means:

- `Backend::Local` has no direct-upload capability
- `Backend::S3` has direct-upload capability

So capability is encoded in the variant, not in a runtime `Option`.

### 9. Practical target shape

The most Rust-native target for this subsystem is:

```rust
enum Backend {
    Local(LocalBackend),
    S3(S3Backend),
}

enum UploadSession {
    Proxy(ProxyUpload),
    DirectPut(DirectPutUpload),
    Multipart(MultipartUpload),
}

struct UploadService {
    backend: Arc<Backend>,
    uploads: Arc<dyn UploadRepo>,
    blobs: Arc<dyn BlobMetaRepo>,
}
```

with:

- strategy-specific completion commands
- private constructors
- explicit transition helpers
- backend-matched capability composition

### 10. What this buys us

If implemented well, this would make the following invalid states unrepresentable:

- mismatched byte store and direct backend
- multipart uploads without multipart ids
- proxy uploads carrying direct-only state
- direct uploads carrying multipart-only state
- completion payloads containing unrelated fields

That is the version of the design that genuinely exploits Rust, instead of only being written in Rust.
