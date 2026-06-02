//! Curated MCP tools and their structured input and output schemas.
//!
//! # Heads up: this catalog is a sketch
//!
//! **None of the tools in this module perform real work.**
//!
//! They are here so we can shape and exercise Canary's MCP boundary while the
//! backing services are still being designed. The names and schemas are useful
//! examples, not the final catalog and not a public contract. Every call
//! currently returns a structured `not_implemented` error.
//!
//! As those services become real, this module should evolve around the
//! workflows agents actually need, with the right authorization and audit
//! behavior. It should not become a mechanical copy of the REST API.

use public_id::PublicId;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::{ErrorData, Json, schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::id::{ChunkId, CollectionId, DocumentId, IngestionId, OperationId, RunId, SourceId};
use crate::idempotency::IdempotencyKey;
use crate::mcp::model::{DocumentState, IngestionState, OperationState, Progress, RunState};
use crate::mcp::{Mcp, error};
use crate::pagination::Limit;

/// Cursor-based arguments shared by compact collection listings.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListCollectionsInput {
    /// Public collection ID after which the next page should begin.
    #[schemars(with = "Option<String>")]
    pub after: Option<PublicId<CollectionId>>,

    /// Maximum number of collections to return.
    #[schemars(with = "Option<usize>")]
    pub limit: Option<Limit>,
}

/// Arguments for grounded retrieval from one private collection.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchCollectionInput {
    /// Public ID of the collection to search.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Natural-language query to search for.
    pub query: String,

    /// Optional metadata filters applied before retrieval.
    pub filters: Option<Value>,

    /// Maximum number of evidence chunks to return.
    #[schemars(with = "Option<usize>")]
    pub limit: Option<Limit>,
}

/// Arguments for browsing documents within one collection.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListDocumentsInput {
    /// Public ID of the collection to browse.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public document ID after which the next page should begin.
    #[schemars(with = "Option<String>")]
    pub after: Option<PublicId<DocumentId>>,

    /// Maximum number of documents to return.
    #[schemars(with = "Option<usize>")]
    pub limit: Option<Limit>,
}

/// Arguments for reading one document summary.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetDocumentInput {
    /// Public ID of the collection that must contain the document.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the document to read.
    #[schemars(with = "String")]
    pub document_id: PublicId<DocumentId>,
}

/// Arguments for adding caller-provided text to a collection.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestTextInput {
    /// Public ID of the collection that should receive the document.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Human-readable document title.
    pub title: String,

    /// Text content to normalize, chunk, and index.
    pub text: String,

    /// Stable caller-provided key that prevents accidental duplicate work.
    #[schemars(with = "String")]
    pub idempotency_key: IdempotencyKey,
}

/// Arguments for fetching and ingesting one external URL.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestUrlInput {
    /// Public ID of the collection that should receive the fetched document.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// External URL to fetch after SSRF and connector policy checks.
    #[schemars(with = "String")]
    pub url: Url,

    /// Stable caller-provided key that prevents accidental duplicate work.
    #[schemars(with = "String")]
    pub idempotency_key: IdempotencyKey,
}

/// Arguments for recomputing derived retrieval state for existing documents.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReprocessDocumentsInput {
    /// Public ID of the collection that must contain every document.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public IDs of documents whose normalized and indexed state should be recomputed.
    #[schemars(with = "Vec<String>")]
    pub document_ids: Vec<PublicId<DocumentId>>,

    /// Stable caller-provided key that prevents accidental duplicate work.
    #[schemars(with = "String")]
    pub idempotency_key: IdempotencyKey,
}

/// Arguments for inspecting one ingestion.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetIngestionStatusInput {
    /// Public ID of the collection that must contain the ingestion.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the ingestion to inspect.
    #[schemars(with = "String")]
    pub ingestion_id: PublicId<IngestionId>,
}

/// Arguments for browsing connector sources within one collection.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListSourcesInput {
    /// Public ID of the collection whose connector sources should be listed.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public source ID after which the next page should begin.
    #[schemars(with = "Option<String>")]
    pub after: Option<PublicId<SourceId>>,

    /// Maximum number of sources to return.
    #[schemars(with = "Option<usize>")]
    pub limit: Option<Limit>,
}

/// Arguments for starting an incremental synchronization of one connector source.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunSourceSyncInput {
    /// Public ID of the collection that contains the connector source.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the connector source to synchronize.
    #[schemars(with = "String")]
    pub source_id: PublicId<SourceId>,

    /// Stable caller-provided key that prevents accidental duplicate work.
    #[schemars(with = "String")]
    pub idempotency_key: IdempotencyKey,
}

/// Arguments for inspecting one connector synchronization run.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetSourceRunStatusInput {
    /// Public ID of the collection that contains the connector source.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the connector source that owns the run.
    #[schemars(with = "String")]
    pub source_id: PublicId<SourceId>,

    /// Public ID of the synchronization run to inspect.
    #[schemars(with = "String")]
    pub run_id: PublicId<RunId>,
}

/// Compact collection metadata returned to agents.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Collection {
    /// Public collection ID.
    #[schemars(with = "String")]
    pub id: PublicId<CollectionId>,

    /// Human-readable collection name.
    pub name: String,

    /// Optional short description that helps agents select a collection.
    pub description: Option<String>,

    /// Link to the canonical MCP resource for this collection.
    #[schemars(with = "String")]
    pub resource: Url,
}

/// One page of collections visible to the current principal.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Collections {
    /// Compact collection summaries.
    pub collections: Vec<Collection>,

    /// Public collection ID that starts the next page, when more collections exist.
    #[schemars(with = "Option<String>")]
    pub next_cursor: Option<PublicId<CollectionId>>,
}

/// Grounded evidence returned by private-knowledge retrieval.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Evidence {
    /// Public chunk ID.
    #[schemars(with = "String")]
    pub chunk_id: PublicId<ChunkId>,

    /// Public ID of the document that contains this chunk.
    #[schemars(with = "String")]
    pub document_id: PublicId<DocumentId>,

    /// Human-readable document title.
    pub title: String,

    /// Bounded text excerpt suitable for immediate grounding.
    pub excerpt: String,

    /// Optional source location such as a heading, page, or URL fragment.
    pub location: Option<String>,

    /// Retrieval relevance score.
    pub score: f32,

    /// Link to the focused chunk resource for deeper context.
    #[schemars(with = "String")]
    pub resource: Url,
}

/// Bounded retrieval results for one natural-language query.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Search {
    /// Public ID of the searched collection.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Query used for retrieval.
    pub query: String,

    /// Grounded evidence ordered by relevance.
    pub evidence: Vec<Evidence>,

    /// Public chunk ID that starts the next result page, when more evidence exists.
    #[schemars(with = "Option<String>")]
    pub next_cursor: Option<PublicId<ChunkId>>,
}

/// Compact document metadata returned to agents.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Document {
    /// Public document ID.
    #[schemars(with = "String")]
    pub id: PublicId<DocumentId>,

    /// Public ID of the containing collection.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Human-readable document title.
    pub title: String,

    /// Current ingestion and indexing state.
    pub state: DocumentState,

    /// Link to the canonical normalized document resource.
    #[schemars(with = "String")]
    pub resource: Url,
}

/// One page of documents visible within a collection.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Documents {
    /// Compact document summaries.
    pub documents: Vec<Document>,

    /// Public document ID that starts the next page, when more documents exist.
    #[schemars(with = "Option<String>")]
    pub next_cursor: Option<PublicId<DocumentId>>,
}

/// Accepted asynchronous work returned by mutating tools.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Accepted {
    /// Public ID of the durable Canary operation.
    #[schemars(with = "String")]
    pub operation_id: PublicId<OperationId>,

    /// Initial operation status.
    pub status: OperationState,

    /// Link to an MCP resource that exposes current operation state.
    #[schemars(with = "String")]
    pub resource: Url,
}

/// Current ingestion state returned to agents.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Ingestion {
    /// Public ingestion ID.
    #[schemars(with = "String")]
    pub id: PublicId<IngestionId>,

    /// Public ID of the containing collection.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Current ingestion state.
    pub status: IngestionState,

    /// Optional normalized progress value between zero and one.
    #[schemars(with = "Option<f32>")]
    pub progress: Option<Progress>,

    /// Link to the ingestion status resource.
    #[schemars(with = "String")]
    pub resource: Url,

    /// Link to diagnostic ingestion events.
    #[schemars(with = "String")]
    pub events: Url,
}

/// Compact connector source metadata returned to agents.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Source {
    /// Public connector source ID.
    #[schemars(with = "String")]
    pub id: PublicId<SourceId>,

    /// Public ID of the containing collection.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Human-readable connector source name.
    pub name: String,

    /// Connector kind such as `web`, `drive`, or `repository`.
    pub kind: String,

    /// Link to the source metadata resource.
    #[schemars(with = "String")]
    pub resource: Url,
}

/// One page of connector sources visible within a collection.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct Sources {
    /// Compact connector source summaries.
    pub sources: Vec<Source>,

    /// Public source ID that starts the next page, when more sources exist.
    #[schemars(with = "Option<String>")]
    pub next_cursor: Option<PublicId<SourceId>>,
}

/// Current connector synchronization state returned to agents.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub struct SourceRun {
    /// Public synchronization run ID.
    #[schemars(with = "String")]
    pub id: PublicId<RunId>,

    /// Public ID of the source being synchronized.
    #[schemars(with = "String")]
    pub source_id: PublicId<SourceId>,

    /// Current synchronization state.
    pub status: RunState,

    /// Optional normalized progress value between zero and one.
    #[schemars(with = "Option<f32>")]
    pub progress: Option<Progress>,

    /// Number of documents created or updated so far.
    pub changed_documents: u64,

    /// Number of source items that failed so far.
    pub failures: u64,

    /// Link to the synchronization run resource.
    #[schemars(with = "String")]
    pub resource: Url,
}

#[tool_router(vis = "pub(crate)")]
impl Mcp {
    /// Lists private-knowledge collections the current principal may read.
    #[tool(
        name = "list_collections",
        description = "List private-knowledge collections the caller may read. Use this before searching when the user has not already identified a collection.",
        annotations(title = "List collections", read_only_hint = true, open_world_hint = false)
    )]
    async fn list_collections(
        &self,
        Parameters(_): Parameters<ListCollectionsInput>,
    ) -> Result<Json<Collections>, ErrorData> {
        Err(error::todo("list_collections"))
    }

    /// Searches one private collection and returns grounded evidence.
    #[tool(
        name = "search_collection",
        description = "Search a collection of ingested documents and return grounded evidence with document metadata, source locations, relevance scores, and resource links. Use this when the user asks a question that may be answered from private or previously ingested knowledge.",
        annotations(title = "Search collection", read_only_hint = true, open_world_hint = false)
    )]
    async fn search_collection(
        &self,
        Parameters(_): Parameters<SearchCollectionInput>,
    ) -> Result<Json<Search>, ErrorData> {
        Err(error::todo("search_collection"))
    }

    /// Lists compact document summaries within one collection.
    #[tool(
        name = "list_documents",
        description = "List compact document summaries within a collection. Use this to browse indexed knowledge or locate a document before reading its metadata.",
        annotations(title = "List documents", read_only_hint = true, open_world_hint = false)
    )]
    async fn list_documents(
        &self,
        Parameters(_): Parameters<ListDocumentsInput>,
    ) -> Result<Json<Documents>, ErrorData> {
        Err(error::todo("list_documents"))
    }

    /// Returns compact metadata and a resource link for one document.
    #[tool(
        name = "get_document",
        description = "Get compact metadata and a canonical resource link for one document. Follow the resource link only when the full normalized content is useful.",
        annotations(title = "Get document", read_only_hint = true, open_world_hint = false)
    )]
    async fn get_document(
        &self,
        Parameters(_): Parameters<GetDocumentInput>,
    ) -> Result<Json<Document>, ErrorData> {
        Err(error::todo("get_document"))
    }

    /// Adds caller-provided text and starts asynchronous ingestion.
    #[tool(
        name = "ingest_text",
        description = "Add caller-provided text to a collection and start asynchronous normalization, chunking, and indexing. Use this only when the user intends to change indexed knowledge.",
        annotations(
            title = "Ingest text",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn ingest_text(
        &self,
        Parameters(_): Parameters<IngestTextInput>,
    ) -> Result<Json<Accepted>, ErrorData> {
        Err(error::todo("ingest_text"))
    }

    /// Fetches an external URL and starts asynchronous ingestion.
    #[tool(
        name = "ingest_url",
        description = "Fetch an external URL after security policy checks and start asynchronous ingestion. Use this only when the user intends to contact the external URL and change indexed knowledge.",
        annotations(
            title = "Ingest URL",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        )
    )]
    async fn ingest_url(
        &self,
        Parameters(_): Parameters<IngestUrlInput>,
    ) -> Result<Json<Accepted>, ErrorData> {
        Err(error::todo("ingest_url"))
    }

    /// Recomputes normalized and indexed state for existing documents.
    #[tool(
        name = "reprocess_documents",
        description = "Re-run normalization, chunking, and indexing for existing documents. Use this to repair or refresh derived retrieval state without creating duplicate source documents.",
        annotations(
            title = "Reprocess documents",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn reprocess_documents(
        &self,
        Parameters(_): Parameters<ReprocessDocumentsInput>,
    ) -> Result<Json<Accepted>, ErrorData> {
        Err(error::todo("reprocess_documents"))
    }

    /// Returns current ingestion progress and diagnostic resource links.
    #[tool(
        name = "get_ingestion_status",
        description = "Inspect current ingestion state, normalized progress, and diagnostic resource links. Use this after starting ingestion or when investigating an ingestion failure.",
        annotations(
            title = "Get ingestion status",
            read_only_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_ingestion_status(
        &self,
        Parameters(_): Parameters<GetIngestionStatusInput>,
    ) -> Result<Json<Ingestion>, ErrorData> {
        Err(error::todo("get_ingestion_status"))
    }

    /// Lists connector sources configured for one collection.
    #[tool(
        name = "list_sources",
        description = "List connector sources configured for a collection. Use this before starting a synchronization when the user has not already identified a source.",
        annotations(title = "List sources", read_only_hint = true, open_world_hint = false)
    )]
    async fn list_sources(
        &self,
        Parameters(_): Parameters<ListSourcesInput>,
    ) -> Result<Json<Sources>, ErrorData> {
        Err(error::todo("list_sources"))
    }

    /// Starts one incremental synchronization against an external connector.
    #[tool(
        name = "run_source_sync",
        description = "Start an incremental synchronization for one external connector source. Use this only after the user explicitly intends to contact the source and update indexed knowledge.",
        annotations(
            title = "Run source sync",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = true
        )
    )]
    async fn run_source_sync(
        &self,
        Parameters(_): Parameters<RunSourceSyncInput>,
    ) -> Result<Json<Accepted>, ErrorData> {
        Err(error::todo("run_source_sync"))
    }

    /// Returns current progress and result counts for one connector synchronization.
    #[tool(
        name = "get_source_run_status",
        description = "Inspect current connector synchronization progress, changed-document counts, failures, and the canonical run resource. Use this after starting a source sync.",
        annotations(
            title = "Get source run status",
            read_only_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_source_run_status(
        &self,
        Parameters(_): Parameters<GetSourceRunStatusInput>,
    ) -> Result<Json<SourceRun>, ErrorData> {
        Err(error::todo("get_source_run_status"))
    }
}
