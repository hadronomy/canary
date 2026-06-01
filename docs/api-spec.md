# Production RAG + MCP Server API and ID Specification

This document defines a cohesive public API shape for a production-grade Rust server that ingests documents and external sources into an agentic RAG system, runs scheduled ingestion tasks, and exposes augmented capabilities through MCP.

The target shape is simple:

**one clean REST API for humans and systems, one MCP surface for agents, and one internal workflow/queue layer behind both.**

The design should follow boring, high-quality API precedents: resource-oriented URLs, stable nouns, standard HTTP methods, idempotent unsafe operations, structured errors, cursor pagination, and long-running operation resources for ingestion work.

---

## 1. Core Architecture

The server should expose three conceptual surfaces:

```txt
REST API      -> humans, dashboards, CLIs, integrations, backend services
MCP API       -> agents and agent runtimes
Worker layer  -> ingestion, sync, parsing, chunking, embedding, indexing, schedules
```

The public API should not expose internal implementation details too early. Internally, the system may have object storage, a document store, a relational database, a vector index, a keyword index, a graph layer, queues, workflow engines, parser workers, OCR workers, embedding workers, and source connectors. Publicly, clients should mostly see collections, files, documents, sources, ingestions, runs, schedules, operations, and search.

Handlers should stay thin. They should validate, authorize, decode, call an application service, and encode a response. The ingestion pipeline, queueing, document lifecycle, parser selection, chunking, embedding, index updates, and schedule execution should live outside the HTTP layer.

That gives the server a polished external API while keeping the inside closer to a proper workflow system.

---

## 2. Core Naming Decision

Use **collections** as the public RAG boundary.

Do not use `knowledge_bases`, `indexes`, or `vector_stores` as the top-level domain word.

`collection` is neutral. It works for documents, web pages, git repositories, tickets, notes, datasets, support articles, internal wiki pages, database records, and future source types. Internally you may have vector indexes, keyword indexes, document stores, embedding stores, and graph stores, but the public API should not force clients to care about those implementation choices.

Recommended conceptual hierarchy:

```txt
collection
  source
    run
  document
    version
    chunk
  ingestion
    event / step / artifact
  search
```

Important wording choices:

```txt
collection      durable retrieval boundary
source          durable external origin of documents
source run      scan/sync attempt for a source
document        canonical content object in a collection
document version immutable snapshot of a document's content/config
chunk           retrieval unit derived from a document version
ingestion       processing run that makes content retrieval-ready
operation       generic long-running async operation
schedule        durable programmed trigger for source syncs or ingestions
```

---

## 3. Top-Level API Surfaces

System endpoints:

```txt
GET  /livez
GET  /readyz
GET  /healthz
GET  /metrics

GET  /openapi.json
GET  /docs
```

MCP endpoints:

```txt
POST /mcp
GET  /mcp
```

REST endpoints:

```txt
/v1/...
```

Keep MCP separate from `/v1`. MCP has its own protocol versioning and transport semantics. It is a protocol endpoint, not a normal REST resource.

Preferred:

```txt
/mcp
```

Acceptable only if you truly need path namespacing:

```txt
/v1/mcp
```

But the cleaner production default is:

```txt
REST -> /v1/...
MCP  -> /mcp
```

---

## 4. Public ID Strategy

### 4.1 Final Recommendation

Use **UUIDv7 internally**, exposed as **typed `PublicId<T>` values serialized as prefixed, compact public IDs**.

Not raw public UUIDs like this:

```txt
0198f9b5-9e27-7287-81a1-6f02a5d79c32
```

Instead, expose Stripe-style IDs like this:

```txt
col_8Jcbs8WkRk8J2qAfWbDPJ7
doc_6wsYqLdc7bhVpY7BN4q3kR
file_5xRjRsF7urU6Y3tTJNh9Kt
ing_4FYkFK8uT9N8rKqQ7uVw1z
```

The actual stored primitive remains UUIDv7.

```txt
Database value: 0198f9b5-9e27-7287-81a1-6f02a5d79c32
API value:      doc_4jJ3LGsGgkHgCe5rfXrBtx
Rust domain:    DocumentId(Uuid)
```

This gives you:

```txt
Database: native uuid
Domain:   strongly typed Rust ID newtypes
API:      typed `PublicId<T>` values serialized as compact prefixed strings
```

### 4.2 Why UUIDv7

UUIDv7 gives you the production trifecta:

1. Globally unique without central coordination.
    
2. Sortable by creation time.
    
3. Better database locality than UUIDv4.
    

Random UUIDv4 primary keys scatter inserts across B-tree indexes. Time-ordered UUIDs keep recent writes closer together, which is much friendlier for database locality. For this server, most core resources are database-backed entities created at high volume: files, documents, chunks, ingestions, source runs, events, and operations. UUIDv7 is the right boring default.

Use raw UUIDv7 for database keys, not encoded strings. The encoding is only an API-boundary concern.

### 4.3 Where Each ID Type Belongs

|Use case|ID type|
|---|---|
|Database primary keys|native `uuid`, generated as UUIDv7|
|Public API resource IDs|prefixed encoded UUIDv7, such as `doc_...`|
|Rust domain IDs|typed newtypes over `Uuid`, such as `DocumentId`|
|Foreign keys|raw `uuid` columns|
|Idempotency keys|client-provided opaque strings|
|Session tokens, magic links, API keys|high-entropy random secrets, not UUIDv7|
|File deduplication|content hash, usually SHA-256 or BLAKE3|
|External source identity|normalized external key plus hash, not primary ID|

### 4.4 Public Prefixes

Use short, readable prefixes:

```txt
col_   collection
file_  file
upl_   upload
doc_   document
ver_   document version
chk_   chunk
src_   source
ing_   ingestion
run_   source run / schedule run
sch_   schedule
op_    operation
evt_   event
```

These IDs make logs, support tickets, traces, metrics, and debugging dramatically nicer.

### 4.5 Security Caveat

Do not treat IDs as permissions.

Knowing this:

```txt
doc_6wsYqLdc7bhVpY7BN4q3kR
```

must never be enough to read the document.

Every request still needs authorization checks:

```txt
authenticated principal can read collection
document belongs to collection
tenant owns collection
source belongs to collection
operation belongs to tenant
```

UUIDv7 also reveals rough creation ordering because it is time-ordered. That is fine for normal resource IDs, but do not use UUIDv7 for secrets, bearer tokens, password reset links, magic links, invite tokens, or API keys.

---

## 5. Public ID Implementation

> Status (2026-06-01): **Done.** This design is now implemented in
> [`crates/public-id`](../crates/public-id) and integrated into the server's
> file and upload APIs with distinct `FileId` and `UploadId` types.

The public/API representation should be typed. Do **not** use an untyped wrapper like this:

```rust
pub struct PublicId(String);
```

That loses information. It tells the compiler that the value is a public ID string, but not what kind of resource it identifies.

Instead, use a generic typed wrapper:

```rust
pub struct PublicId<T: ResourceId>(T);
```

This gives precise API-boundary types:

```rust
PublicId<DocumentId>     // public document ID
PublicId<CollectionId>   // public collection ID
PublicId<IngestionId>    // public ingestion ID
```

The design becomes:

```txt
ResourceId          -> domain identity trait
DocumentId          -> strongly typed domain ID
PublicId<DocumentId> -> typed public/API representation
Uuid                -> database storage primitive
```

### 5.1 Cargo Dependencies

```toml
[dependencies]
uuid = { version = "1", features = ["v7", "serde"] }
bs58 = "0.5"
serde = { version = "1", features = ["derive"] }
thiserror = "2"
```

### 5.2 Error Type

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PublicIdError {
    #[error("invalid id format")]
    InvalidFormat,

    #[error("invalid id prefix: expected `{expected}`, got `{actual}`")]
    InvalidPrefix {
        expected: &'static str,
        actual: String,
    },

    #[error("invalid id body")]
    InvalidBody,
}
```

### 5.3 Minimal `ResourceId` Trait

Keep `ResourceId` focused on domain identity.

Do not put `to_public_id` or `parse_public_id` on this trait. Those are API encoding concerns, not identity behavior.

```rust
use uuid::Uuid;

pub trait ResourceId:
    Sized + Copy + Eq + std::hash::Hash + std::fmt::Debug
{
    const PREFIX: &'static str;

    fn from_uuid(uuid: Uuid) -> Self;

    fn as_uuid(self) -> Uuid;

    fn new() -> Self {
        Self::from_uuid(Uuid::now_v7())
    }
}
```

### 5.4 Typed `PublicId<T>` Boundary Wrapper

```rust
use std::{fmt, str::FromStr};

use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct PublicId<T: ResourceId>(T);

impl<T: ResourceId> PublicId<T> {
    pub fn new(id: T) -> Self {
        Self(id)
    }

    pub fn into_inner(self) -> T {
        self.0
    }

    pub fn inner(self) -> T {
        self.0
    }

    pub fn as_uuid(self) -> Uuid {
        self.0.as_uuid()
    }

    pub fn encode(self) -> String {
        let encoded = bs58::encode(self.0.as_uuid().into_bytes()).into_string();
        format!("{}_{}", T::PREFIX, encoded)
    }

    pub fn decode(input: &str) -> Result<Self, PublicIdError> {
        let Some((prefix, body)) = input.split_once('_') else {
            return Err(PublicIdError::InvalidFormat);
        };

        if prefix != T::PREFIX {
            return Err(PublicIdError::InvalidPrefix {
                expected: T::PREFIX,
                actual: prefix.to_owned(),
            });
        }

        let bytes = bs58::decode(body)
            .into_vec()
            .map_err(|_| PublicIdError::InvalidBody)?;

        let bytes: [u8; 16] = bytes
            .try_into()
            .map_err(|_| PublicIdError::InvalidBody)?;

        Ok(Self(T::from_uuid(Uuid::from_bytes(bytes))))
    }
}

impl<T: ResourceId> From<T> for PublicId<T> {
    fn from(id: T) -> Self {
        Self(id)
    }
}

impl<T: ResourceId> fmt::Display for PublicId<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.encode())
    }
}

impl<T: ResourceId> FromStr for PublicId<T> {
    type Err = PublicIdError;

    fn from_str(input: &str) -> Result<Self, Self::Err> {
        Self::decode(input)
    }
}

impl<T: ResourceId> TryFrom<&str> for PublicId<T> {
    type Error = PublicIdError;

    fn try_from(input: &str) -> Result<Self, Self::Error> {
        Self::decode(input)
    }
}

impl<T: ResourceId> TryFrom<String> for PublicId<T> {
    type Error = PublicIdError;

    fn try_from(input: String) -> Result<Self, Self::Error> {
        Self::decode(&input)
    }
}
```

This avoids the information loss of `PublicId(String)`. The type system knows whether the public ID is a document ID, collection ID, source ID, ingestion ID, or any other resource ID.

### 5.5 Serde for `PublicId<T>`

API DTOs should serialize typed public IDs as strings:

```rust
impl<T: ResourceId> serde::Serialize for PublicId<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de, T: ResourceId> serde::Deserialize<'de> for PublicId<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::decode(&value).map_err(serde::de::Error::custom)
    }
}
```

Then API DTOs can be explicit:

```rust
#[derive(Debug, serde::Serialize)]
pub struct DocumentResponse {
    pub id: PublicId<DocumentId>,
    pub collection_id: PublicId<CollectionId>,
    pub title: String,
}
```

Serialized JSON:

```json
{
  "id": "doc_4jJ3LGsGgkHgCe5rfXrBtx",
  "collection_id": "col_8Jcbs8WkRk8J2qAfWbDPJ7",
  "title": "Contract.pdf"
}
```

### 5.6 Typed ID Macro

```rust
macro_rules! resource_id {
    ($name:ident, $prefix:literal) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                <Self as ResourceId>::new()
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(self) -> Uuid {
                self.0
            }
        }

        impl ResourceId for $name {
            const PREFIX: &'static str = $prefix;

            fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            fn as_uuid(self) -> Uuid {
                self.0
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Self {
                id.0
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl From<$name> for PublicId<$name> {
            fn from(id: $name) -> Self {
                PublicId::new(id)
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                PublicId::from(*self).fmt(f)
            }
        }

        impl std::str::FromStr for $name {
            type Err = PublicIdError;

            fn from_str(input: &str) -> Result<Self, Self::Err> {
                PublicId::<Self>::decode(input).map(PublicId::into_inner)
            }
        }

        impl TryFrom<&str> for $name {
            type Error = PublicIdError;

            fn try_from(input: &str) -> Result<Self, Self::Error> {
                PublicId::<Self>::decode(input).map(PublicId::into_inner)
            }
        }

        impl TryFrom<String> for $name {
            type Error = PublicIdError;

            fn try_from(input: String) -> Result<Self, Self::Error> {
                Self::try_from(input.as_str())
            }
        }
    };
}

resource_id!(CollectionId, "col");
resource_id!(DocumentId, "doc");
resource_id!(FileId, "file");
resource_id!(UploadId, "upl");
resource_id!(DocumentVersionId, "ver");
resource_id!(ChunkId, "chk");
resource_id!(SourceId, "src");
resource_id!(IngestionId, "ing");
resource_id!(RunId, "run");
resource_id!(ScheduleId, "sch");
resource_id!(OperationId, "op");
resource_id!(EventId, "evt");
```

This still allows ergonomic parsing on concrete IDs:

```rust
let document_id: DocumentId = "doc_4jJ3LGsGgkHgCe5rfXrBtx".parse()?;
let document_id = DocumentId::try_from("doc_4jJ3LGsGgkHgCe5rfXrBtx")?;
```

But it also gives precise API-boundary types:

```rust
let public_id = PublicId::<DocumentId>::try_from("doc_4jJ3LGsGgkHgCe5rfXrBtx")?;
let document_id = public_id.into_inner();
```

### 5.7 Domain DTO Split

Use this split:

```txt
Domain layer:   DocumentId
Database layer: Uuid
API DTO layer:  PublicId<DocumentId>
```

Domain model:

```rust
pub struct Document {
    pub id: DocumentId,
    pub collection_id: CollectionId,
    pub title: String,
}
```

API response DTO:

```rust
#[derive(Debug, serde::Serialize)]
pub struct DocumentResponse {
    pub id: PublicId<DocumentId>,
    pub collection_id: PublicId<CollectionId>,
    pub title: String,
}
```

Mapping:

```rust
impl From<Document> for DocumentResponse {
    fn from(document: Document) -> Self {
        Self {
            id: PublicId::from(document.id),
            collection_id: PublicId::from(document.collection_id),
            title: document.title,
        }
    }
}
```

This keeps the boundary honest:

```txt
domain model -> API response DTO
```

### 5.8 Usage

```rust
let document_id = DocumentId::new();

let public_id = PublicId::from(document_id);
let public_string = document_id.to_string();

let parsed_a: DocumentId = public_string.parse()?;
let parsed_b = DocumentId::try_from(public_id.to_string())?;
let parsed_c = PublicId::<DocumentId>::try_from(public_string)?.into_inner();
```

### 5.9 SQL Shape

In Postgres, keep real columns as `uuid`:

```sql
create table collections (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key,
  collection_id uuid not null references collections(id),
  title text not null,
  state text not null,
  created_at timestamptz not null default now()
);
```

When inserting:

```rust
sqlx::query!(
    r#"
    insert into documents (id, collection_id, title)
    values ($1, $2, $3)
    "#,
    document_id.as_uuid(),
    collection_id.as_uuid(),
    title,
)
.execute(&pool)
.await?;
```

When reading:

```rust
let row = sqlx::query!(
    r#"
    select id, collection_id, title
    from documents
    where id = $1
    "#,
    document_id.as_uuid(),
)
.fetch_one(&pool)
.await?;

let response = DocumentResponse {
    id: PublicId::from(DocumentId::from_uuid(row.id)),
    collection_id: PublicId::from(CollectionId::from_uuid(row.collection_id)),
    title: row.title,
};
```

### 5.10 Base32 Alternative

Base32 is slightly longer but more conservative and uppercase-only:

```txt
doc_AGMPZGL3EZZIPAILN4BKLV44GI
```

Dependency:

```toml
data-encoding = "2"
```

Implementation:

```rust
use data_encoding::BASE32_NOPAD;

fn encode_uuid_base32(uuid: Uuid) -> String {
    BASE32_NOPAD.encode(&uuid.into_bytes())
}

fn decode_uuid_base32(input: &str) -> Result<Uuid, PublicIdError> {
    let bytes = BASE32_NOPAD
        .decode(input.as_bytes())
        .map_err(|_| PublicIdError::InvalidBody)?;

    let bytes: [u8; 16] = bytes
        .try_into()
        .map_err(|_| PublicIdError::InvalidBody)?;

    Ok(Uuid::from_bytes(bytes))
}
```

### 5.11 Actual Choice

Use **typed `PublicId<T>` values encoded as base58 UUIDv7 IDs**:

```rust
PublicId<DocumentId>
```

serialized as:

```txt
doc_4jJ3LGsGgkHgCe5rfXrBtx
```

This is compact, URL-safe, copy-paste friendly, and visually nicer than raw UUIDs. Internally, nothing changes: you still get the operational sanity of UUIDv7 in Postgres and strongly typed Rust IDs in the domain.

---

## 6. Recommended Public REST API

### 6.1 Collections

A collection is the durable retrieval boundary. It answers: “Where should this knowledge live?”

```txt
POST   /v1/collections
GET    /v1/collections
GET    /v1/collections/{collection_id}
PATCH  /v1/collections/{collection_id}
DELETE /v1/collections/{collection_id}
```

Example collection:

```json
{
  "id": "col_8Jcbs8WkRk8J2qAfWbDPJ7",
  "name": "legal-documents",
  "display_name": "Legal Documents",
  "description": "Contracts, policies, invoices and regulations used by the agent.",
  "state": "active",
  "metadata": {
    "tenant": "mze"
  },
  "created_at": "2026-05-26T01:42:00Z",
  "updated_at": "2026-05-26T01:42:00Z"
}
```

Collection states:

```txt
creating
active
degraded
archived
deleted
```

Use `archived` as soft-delete when the knowledge should no longer be searched but audit/history matters.

---

### 6.2 Files

Files are raw binary objects. They are not documents yet.

A file is:

```txt
we received bytes
```

A document is:

```txt
we understand this as an ingestible source of knowledge
```

File endpoints:

```txt
POST   /v1/files
GET    /v1/files
GET    /v1/files/{file_id}
DELETE /v1/files/{file_id}
```

For serious uploads, support both modes.

Small multipart upload:

```txt
POST /v1/files
```

Large/direct upload flow:

```txt
POST /v1/uploads
GET  /v1/uploads/{upload_id}
POST /v1/uploads/{upload_id}/parts
POST /v1/uploads/{upload_id}/complete
POST /v1/uploads/{upload_id}/abort
```

For production, prefer **direct-to-object-storage presigned uploads** for large files, followed by a small metadata call to your API. The Rust server should not become the byte mule unless you explicitly need virus scanning, content sniffing, policy enforcement, or content normalization in the request path.

---

### 6.3 Documents

Documents are canonical content objects inside a collection.

```txt
POST   /v1/collections/{collection_id}/documents
GET    /v1/collections/{collection_id}/documents
GET    /v1/collections/{collection_id}/documents/{document_id}
PATCH  /v1/collections/{collection_id}/documents/{document_id}
DELETE /v1/collections/{collection_id}/documents/{document_id}
```

Creation should accept different origins.

From file:

```json
{
  "source_type": "file",
  "file_id": "file_5xRjRsF7urU6Y3tTJNh9Kt",
  "title": "Contrato de arrendamiento.pdf",
  "metadata": {
    "department": "legal",
    "language": "es"
  },
  "ingestion": {
    "pipeline_id": "pipe_default",
    "mode": "async"
  }
}
```

From URL:

```json
{
  "source_type": "url",
  "url": "https://example.com/policy",
  "title": "Company Policy"
}
```

From text:

```json
{
  "source_type": "text",
  "text": "Raw text to ingest...",
  "title": "Manual note"
}
```

This is cleaner than creating endpoint names like:

```txt
/ingest-file
/ingest-url
/ingest-text
/upload-and-index
```

Those names rot quickly. Model the resource correctly and let the payload describe the input type.

---

### 6.4 Ingestions

An ingestion is the asynchronous processing run that transforms source material into parsed content, chunks, embeddings, search indexes, summaries, metadata, and retrieval-ready state.

```txt
POST /v1/collections/{collection_id}/ingestions
GET  /v1/collections/{collection_id}/ingestions
GET  /v1/collections/{collection_id}/ingestions/{ingestion_id}
POST /v1/collections/{collection_id}/ingestions/{ingestion_id}/cancel
```

Create ingestion:

```json
{
  "input": {
    "document_ids": ["doc_6wsYqLdc7bhVpY7BN4q3kR"]
  },
  "pipeline_id": "pipe_default",
  "reason": "manual_reprocess"
}
```

Response should be a long-running operation or an ingestion resource with operation semantics:

```json
{
  "id": "ing_4FYkFK8uT9N8rKqQ7uVw1z",
  "collection_id": "col_8Jcbs8WkRk8J2qAfWbDPJ7",
  "state": "running",
  "pipeline_id": "pipe_default",
  "progress": {
    "current_step": "chunking",
    "completed_steps": 3,
    "total_steps": 7
  },
  "created_at": "2026-05-26T01:42:00Z",
  "started_at": "2026-05-26T01:42:04Z",
  "completed_at": null
}
```

Recommended ingestion states:

```txt
queued
running
cancelling
cancelled
succeeded
failed
```

Recommended document indexing states:

```txt
pending
processing
ready
failed
stale
archived
```

Keep job/run states simple. Keep pipeline-step states detailed.

---

### 6.5 Ingestion Events

Ingestion events are essential for debugging, auditability, and agent observability.

```txt
GET /v1/collections/{collection_id}/ingestions/{ingestion_id}/events
```

Example:

```json
{
  "data": [
    {
      "id": "evt_5UuY9MsUhpDZTfHVxmTq5Q",
      "level": "info",
      "step": "parse",
      "message": "Extracted 42 pages and 18 tables",
      "created_at": "2026-05-26T01:42:10Z"
    },
    {
      "id": "evt_5UuY9MsUhpDZTfHVxmTq5R",
      "level": "warning",
      "step": "ocr",
      "message": "Low confidence OCR on page 17",
      "created_at": "2026-05-26T01:42:18Z"
    }
  ],
  "next_cursor": null
}
```

Do not bury this in logs only. Users, agents, operators, and support tools will need it.

---

### 6.6 Document Versions

Document versions should be scaffolded early.

```txt
GET /v1/collections/{collection_id}/documents/{document_id}/versions
GET /v1/collections/{collection_id}/documents/{document_id}/versions/{version_id}
```

A document changes when its bytes, URL content hash, parser options, or metadata change. That should produce a new version and usually a new ingestion.

Versions let you answer questions like:

```txt
Which source content produced these chunks?
Which parser configuration produced this search result?
When did the document become stale?
What changed between two ingestions?
```

---

### 6.7 Chunks

Expose chunks carefully. They are useful for debugging, evaluation, citation, and agent source-grounding, but they can leak implementation details if overexposed.

```txt
GET /v1/collections/{collection_id}/documents/{document_id}/chunks
GET /v1/collections/{collection_id}/chunks/{chunk_id}
```

Chunk response:

```json
{
  "id": "chk_7h1ZkGrdSyW4zRqT8zXTsA",
  "document_id": "doc_6wsYqLdc7bhVpY7BN4q3kR",
  "text": "Extracted chunk text...",
  "position": {
    "page": 3,
    "section": "2.1",
    "ordinal": 17
  },
  "metadata": {
    "heading": "Termination",
    "language": "en"
  }
}
```

Do **not** expose raw embedding vectors by default. That is almost always the wrong public abstraction.

If embeddings ever need to be exposed, that should be an explicit admin/debug endpoint with strict authorization, not a normal chunk field.

---

### 6.8 Search and Retrieval

Separate “search” from “answer generation.”

This server is the RAG substrate, not necessarily the model runtime.

```txt
POST /v1/collections/{collection_id}/search
```

Request:

```json
{
  "query": "What does the contract say about early termination?",
  "mode": "hybrid",
  "limit": 10,
  "filters": {
    "department": "legal",
    "language": "en"
  },
  "include": ["chunks", "documents", "scores"]
}
```

Response:

```json
{
  "data": [
    {
      "chunk_id": "chk_7h1ZkGrdSyW4zRqT8zXTsA",
      "document_id": "doc_6wsYqLdc7bhVpY7BN4q3kR",
      "score": 0.87,
      "text": "Either party may terminate...",
      "source": {
        "title": "Contract.pdf",
        "page": 12
      }
    }
  ]
}
```

For agent usage, this maps cleanly to an MCP tool:

```txt
search_collection
```

with arguments:

```json
{
  "collection_id": "col_8Jcbs8WkRk8J2qAfWbDPJ7",
  "query": "What does the contract say about early termination?",
  "filters": {},
  "limit": 10
}
```

Supported search modes:

```txt
semantic
keyword
hybrid
```

Potential future modes:

```txt
hybrid_reranked
graph_augmented
metadata_only
```

Start with `hybrid` as the default once both lexical and vector search are available.

---

### 6.9 Sources

Sources are durable external origins: folders, websites, GitHub repositories, Notion spaces, Google Drive folders, S3 prefixes, RSS feeds, databases, email inboxes, issue trackers, and similar systems.

```txt
POST   /v1/collections/{collection_id}/sources
GET    /v1/collections/{collection_id}/sources
GET    /v1/collections/{collection_id}/sources/{source_id}
PATCH  /v1/collections/{collection_id}/sources/{source_id}
DELETE /v1/collections/{collection_id}/sources/{source_id}
```

Example source:

```json
{
  "id": "src_5Ftm4xgUdKzZuy1zrUfKe3",
  "type": "web",
  "name": "docs-site",
  "config": {
    "base_url": "https://docs.example.com",
    "include": ["/**"],
    "exclude": ["/archive/**"]
  },
  "schedule_id": "sch_5UcFzv2g58krMZ7dfRWuVL"
}
```

Use a `type` field, not separate endpoint families like:

```txt
/github-sources
/google-drive-sources
/web-sources
/s3-sources
```

Connector-specific config belongs in a typed payload.

Potential source types:

```txt
file_upload
web
github
google_drive
s3
rss
notion
confluence
linear
jira
postgres
email
api
```

---

### 6.10 Source Runs / Sync Runs

A source run is a scheduled or manual scan of an external source.

```txt
POST /v1/collections/{collection_id}/sources/{source_id}/runs
GET  /v1/collections/{collection_id}/sources/{source_id}/runs
GET  /v1/collections/{collection_id}/sources/{source_id}/runs/{run_id}
POST /v1/collections/{collection_id}/sources/{source_id}/runs/{run_id}/cancel
```

Manual run:

```json
{
  "reason": "manual",
  "mode": "incremental"
}
```

Modes:

```txt
incremental
full
validate_only
```

A source run may produce many document ingestions. Keep those linked:

```json
{
  "id": "run_4cxGTVqWGBNAUoJY3QXskD",
  "source_id": "src_5Ftm4xgUdKzZuy1zrUfKe3",
  "state": "running",
  "mode": "incremental",
  "documents_seen": 143,
  "documents_created": 12,
  "documents_updated": 4,
  "documents_deleted": 0,
  "ingestion_ids": [
    "ing_4FYkFK8uT9N8rKqQ7uVw1z",
    "ing_8kfUMmMckS4NpNM6xW9EVD"
  ]
}
```

Recommended source run states:

```txt
queued
running
cancelling
cancelled
succeeded
failed
partially_succeeded
```

Use `partially_succeeded` for connector runs where some documents synced and others failed.

---

### 6.11 Schedules

Schedules should be first-class resources, not hidden cron strings in config.

```txt
POST   /v1/schedules
GET    /v1/schedules
GET    /v1/schedules/{schedule_id}
PATCH  /v1/schedules/{schedule_id}
DELETE /v1/schedules/{schedule_id}

POST   /v1/schedules/{schedule_id}/pause
POST   /v1/schedules/{schedule_id}/resume
POST   /v1/schedules/{schedule_id}/trigger
GET    /v1/schedules/{schedule_id}/runs
```

Example:

```json
{
  "id": "sch_5UcFzv2g58krMZ7dfRWuVL",
  "target": {
    "type": "source",
    "source_id": "src_5Ftm4xgUdKzZuy1zrUfKe3"
  },
  "cron": "0 */6 * * *",
  "timezone": "Atlantic/Canary",
  "state": "active",
  "misfire_policy": "run_once",
  "overlap_policy": "skip",
  "created_at": "2026-05-26T01:42:00Z"
}
```

Recommended policies:

```txt
misfire_policy: skip | run_once | run_all
overlap_policy: allow | skip | cancel_previous | queue
```

This is much better than sprinkling cron logic inside handlers.

For implementation:

```txt
Apalis/apalis-cron -> pragmatic in-process Rust scheduling
Temporal           -> durable workflows across crashes/deployments
```

If schedules are business-critical, must survive deploys cleanly, require retries, need backfills, or have multi-step workflows, use a durable workflow system. If schedules are simple and the service is small, an in-process scheduler can be acceptable at first, provided the database remains the source of truth.

---

### 6.12 Operations

You can either expose `ingestions` and `runs` directly as your long-running resources, or add a generic operations API.

Use both.

```txt
GET  /v1/operations/{operation_id}
POST /v1/operations/{operation_id}/cancel
```

Every async creation response can include:

```json
{
  "operation_id": "op_9x6Y3dM2Fdt3Pg28U8AFha",
  "resource_type": "ingestion",
  "resource_id": "ing_4FYkFK8uT9N8rKqQ7uVw1z",
  "state": "running"
}
```

Operations are the generic polling/cancellation abstraction. Ingestions and runs are the domain-specific resources.

Recommended operation states:

```txt
queued
running
cancelling
cancelled
succeeded
failed
```

Operation response:

```json
{
  "id": "op_9x6Y3dM2Fdt3Pg28U8AFha",
  "state": "running",
  "resource": {
    "type": "ingestion",
    "id": "ing_4FYkFK8uT9N8rKqQ7uVw1z"
  },
  "progress": {
    "current_step": "embedding",
    "completed_steps": 5,
    "total_steps": 7
  },
  "error": null,
  "created_at": "2026-05-26T01:42:00Z",
  "started_at": "2026-05-26T01:42:04Z",
  "completed_at": null
}
```

For failed operations, put execution failures on the operation:

```json
{
  "id": "op_9x6Y3dM2Fdt3Pg28U8AFha",
  "state": "failed",
  "resource": {
    "type": "ingestion",
    "id": "ing_4FYkFK8uT9N8rKqQ7uVw1z"
  },
  "error": {
    "code": "parser_failed",
    "message": "The PDF parser failed on page 17."
  },
  "created_at": "2026-05-26T01:42:00Z",
  "started_at": "2026-05-26T01:42:04Z",
  "completed_at": "2026-05-26T01:43:10Z"
}
```

---

## 7. Cross-Cutting API Standards

### 7.1 Response Envelope

Use a boring, consistent shape.

Single resource:

```json
{
  "data": {
    "id": "doc_6wsYqLdc7bhVpY7BN4q3kR",
    "object": "document"
  }
}
```

List response:

```json
{
  "data": [],
  "next_cursor": "eyJvZmZzZXQiOjEwMH0="
}
```

The `object` field is optional, but it can be useful in logs, SDKs, and polymorphic responses:

```txt
collection
document
file
source
ingestion
operation
schedule
```

---

### 7.2 Error Response

Use `application/problem+json`.

Example:

```json
{
  "type": "https://api.example.com/problems/invalid-request",
  "title": "Invalid request",
  "status": 400,
  "detail": "The file_id does not belong to this collection.",
  "instance": "req_7t9S4TdzULPpJ2Ak3RcKXh",
  "code": "file_collection_mismatch",
  "errors": [
    {
      "field": "file_id",
      "message": "File belongs to another collection."
    }
  ]
}
```

Recommended top-level error fields:

```txt
type       stable URL identifying the problem family
title      human-readable summary
status     HTTP status code
detail     specific human-readable explanation
instance   request ID / trace ID / error occurrence ID
code       stable machine-readable application error code
errors     field-level validation errors
```

Error codes should be stable. Error messages can improve over time.

---

### 7.3 Idempotency

Require `Idempotency-Key` on unsafe creation/trigger operations:

```txt
POST /v1/files
POST /v1/uploads
POST /v1/collections/{collection_id}/documents
POST /v1/collections/{collection_id}/ingestions
POST /v1/collections/{collection_id}/sources/{source_id}/runs
POST /v1/schedules/{schedule_id}/trigger
```

The server should store:

```txt
idempotency key
principal / tenant
method
route fingerprint
request body hash
response status
response body
expiration
```

If the same key is replayed with the same request fingerprint, return the original response.

If the same key is replayed with a different request fingerprint, return a conflict error:

```json
{
  "type": "https://api.example.com/problems/idempotency-key-conflict",
  "title": "Idempotency key conflict",
  "status": 409,
  "detail": "This idempotency key was already used with a different request body.",
  "code": "idempotency_key_conflict"
}
```

---

### 7.4 Pagination

Use cursor pagination everywhere:

```txt
?page_size=50&page_cursor=...
```

Response:

```json
{
  "data": [],
  "next_cursor": "..."
}
```

Avoid offset pagination for large document, chunk, source run, ingestion event, and operation lists.

Recommended list parameters:

```txt
page_size
page_cursor
sort
order
```

Default:

```txt
page_size = 50
max_page_size = 200
order = desc
sort = created_at
```

---

### 7.5 Filtering

Keep filters boring for list endpoints:

```txt
GET /v1/collections/{collection_id}/documents?state=ready&source_id=src_...
GET /v1/collections/{collection_id}/ingestions?state=failed
GET /v1/schedules?state=active
```

For complex filters, use POST search endpoints instead of inventing a query language too early.

Good simple filters:

```txt
state
source_id
document_id
created_after
created_before
updated_after
updated_before
metadata.<key>
```

Avoid designing a full public DSL until you have enough usage pressure to justify it.

---

### 7.6 JSON Casing

Use `snake_case` JSON fields consistently.

```json
{
  "created_at": "...",
  "next_cursor": "...",
  "source_type": "file"
}
```

This keeps public DTOs aligned with Rust `serde` and avoids endless renaming noise.

---

### 7.7 Request IDs and Tracing

Every response should include a request ID.

Header:

```txt
x-request-id: req_7t9S4TdzULPpJ2Ak3RcKXh
```

Error body:

```json
{
  "instance": "req_7t9S4TdzULPpJ2Ak3RcKXh"
}
```

Every ingestion, source run, schedule run, and operation should be traceable across:

```txt
HTTP request
application service call
job enqueue
worker execution
parser logs
embedding calls
index writes
event records
```

---

### 7.8 Auth, Tenancy, and Permissions

Do not rely on nested paths alone for security.

For every nested route, verify containment:

```txt
collection belongs to tenant
document belongs to collection
source belongs to collection
ingestion belongs to collection
run belongs to source
schedule target belongs to tenant
operation belongs to tenant
```

Good route shape:

```txt
GET /v1/collections/{collection_id}/documents/{document_id}
```

But the handler must still enforce:

```txt
document.collection_id == collection_id
principal can read collection_id
```

MCP tools need the same authorization model as REST endpoints.

---

## 8. MCP Tool Surface

Do not expose every REST endpoint as an MCP tool. That creates noisy, unsafe, low-signal tools.

Expose a curated agent surface:

```txt
search_collection
get_document
list_documents
ingest_text
ingest_url
create_ingestion
get_ingestion_status
list_sources
run_source_sync
get_source_run_status
```

For destructive/admin operations, either do not expose them or require explicit approval:

```txt
delete_document
delete_collection
pause_schedule
resume_schedule
```

MCP tools should be named for agent comprehension, not REST purity. The REST endpoint can be:

```txt
POST /v1/collections/{collection_id}/search
```

while the MCP tool is:

```txt
search_collection
```

MCP tool descriptions should be explicit, because agents use those descriptions to decide which tool to call.

Bad:

```txt
Search docs.
```

Better:

```txt
Search a collection of ingested documents and return grounded chunks with document metadata, source locations, and relevance scores. Use this when the user asks a question that may be answered from private or previously ingested knowledge.
```

Example MCP tool schema:

```json
{
  "name": "search_collection",
  "description": "Search a collection of ingested documents and return grounded chunks with document metadata, source locations, and relevance scores.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "collection_id": {
        "type": "string",
        "description": "The collection to search, such as col_8Jcbs8WkRk8J2qAfWbDPJ7."
      },
      "query": {
        "type": "string",
        "description": "The natural language query to search for."
      },
      "filters": {
        "type": "object",
        "description": "Optional metadata filters."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 10
      }
    },
    "required": ["collection_id", "query"]
  }
}
```

MCP tool security requirements:

```txt
validate all inputs
authorize every tool call
rate-limit tool invocations
sanitize outputs
avoid accidental secret leakage
require explicit confirmation for destructive operations
preserve audit logs
```

---

## 9. Implementation Notes

The directory-tree scaffold is intentionally omitted here. The important implementation shape is architectural, not a fixed folder layout.

Use Axum’s `IntoResponse` pattern for a single `ApiError` type and one response path. Keep every handler returning the same result style.

Use `tower-http` for HTTP middleware:

```txt
tracing
request IDs
CORS
compression
timeouts
body limits
sensitive header handling
```

For OpenAPI, use either:

```txt
utoipa
```

if you want derive-heavy, explicit OpenAPI generation, or:

```txt
aide
```

if you want Axum-integrated route documentation with stronger type-driven ergonomics.

Treat OpenAPI as a first-class artifact, not generated documentation you glance at once.

The OpenAPI descriptions should be written for both humans and agents. Structurally valid schemas are not enough. Tool and endpoint descriptions need to explain when to use the operation, what the resource means, and what side effects it has.

Recommended handler shape:

```txt
extract auth context
extract path/query/body
validate request
authorize action
call application service
map domain result to API DTO
return response envelope
```

Recommended service shape:

```txt
application service owns use-case orchestration
domain types enforce invariants
repositories perform persistence
workers perform slow processing
object store owns bytes
index abstraction owns retrieval indexes
scheduler owns programmed execution
```

---

## 10. Clean Final Endpoint Map

```txt
# System
GET    /livez
GET    /readyz
GET    /healthz
GET    /metrics
GET    /openapi.json
GET    /docs

# MCP
POST   /mcp
GET    /mcp

# Collections
POST   /v1/collections
GET    /v1/collections
GET    /v1/collections/{collection_id}
PATCH  /v1/collections/{collection_id}
DELETE /v1/collections/{collection_id}

# Files and uploads
POST   /v1/files
GET    /v1/files
GET    /v1/files/{file_id}
DELETE /v1/files/{file_id}

POST   /v1/uploads
GET    /v1/uploads/{upload_id}
POST   /v1/uploads/{upload_id}/parts
POST   /v1/uploads/{upload_id}/complete
POST   /v1/uploads/{upload_id}/abort

# Documents
POST   /v1/collections/{collection_id}/documents
GET    /v1/collections/{collection_id}/documents
GET    /v1/collections/{collection_id}/documents/{document_id}
PATCH  /v1/collections/{collection_id}/documents/{document_id}
DELETE /v1/collections/{collection_id}/documents/{document_id}

GET    /v1/collections/{collection_id}/documents/{document_id}/versions
GET    /v1/collections/{collection_id}/documents/{document_id}/versions/{version_id}
GET    /v1/collections/{collection_id}/documents/{document_id}/chunks
GET    /v1/collections/{collection_id}/chunks/{chunk_id}

# Ingestions
POST   /v1/collections/{collection_id}/ingestions
GET    /v1/collections/{collection_id}/ingestions
GET    /v1/collections/{collection_id}/ingestions/{ingestion_id}
POST   /v1/collections/{collection_id}/ingestions/{ingestion_id}/cancel
GET    /v1/collections/{collection_id}/ingestions/{ingestion_id}/events

# Sources
POST   /v1/collections/{collection_id}/sources
GET    /v1/collections/{collection_id}/sources
GET    /v1/collections/{collection_id}/sources/{source_id}
PATCH  /v1/collections/{collection_id}/sources/{source_id}
DELETE /v1/collections/{collection_id}/sources/{source_id}

POST   /v1/collections/{collection_id}/sources/{source_id}/runs
GET    /v1/collections/{collection_id}/sources/{source_id}/runs
GET    /v1/collections/{collection_id}/sources/{source_id}/runs/{run_id}
POST   /v1/collections/{collection_id}/sources/{source_id}/runs/{run_id}/cancel

# Schedules
POST   /v1/schedules
GET    /v1/schedules
GET    /v1/schedules/{schedule_id}
PATCH  /v1/schedules/{schedule_id}
DELETE /v1/schedules/{schedule_id}
POST   /v1/schedules/{schedule_id}/pause
POST   /v1/schedules/{schedule_id}/resume
POST   /v1/schedules/{schedule_id}/trigger
GET    /v1/schedules/{schedule_id}/runs

# Retrieval
POST   /v1/collections/{collection_id}/search

# Generic operations
GET    /v1/operations/{operation_id}
POST   /v1/operations/{operation_id}/cancel
```

---

## 11. Final Architectural Stance

The server should feel like this externally:

```txt
predictable
resource-oriented
safe to retry
well-documented
agent-friendly
observable
```

And internally:

```txt
domain-driven
workflow-aware
queue-backed
strongly typed
permission checked
traceable
boring under pressure
```

The most important decisions are:

1. Use `collections` as the public RAG boundary.
    
2. Keep MCP separate from the REST API.
    
3. Treat sources, runs, schedules, ingestions, and operations as first-class resources.
    
4. Use UUIDv7 in storage and typed `PublicId<T>` wrappers encoded as prefixed base58 IDs at the API boundary.
    
5. Make ingestion asynchronous and observable.
    
6. Use cursor pagination, idempotency keys, structured errors, and request IDs from the beginning.
    
7. Keep handlers thin; put real behavior in services, workers, workflows, and domain types.
    

That combination gives you a server that is delightful to integrate with, pleasant to debug, safe for agents to use, and ready to evolve without painting the API into a corner.
