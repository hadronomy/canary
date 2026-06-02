//! Prompt-backed skills for common agent workflows.
//!
//! MCP prompts are user-selectable workflows. They describe how an agent
//! should combine Canary tools and resources without hiding side effects or
//! silently starting work.

use public_id::PublicId;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{PromptMessage, PromptMessageRole};
use rmcp::{prompt, prompt_router, schemars};
use serde::Deserialize;

use crate::id::{CollectionId, IngestionId, SourceId};
use crate::mcp::Mcp;

/// Arguments for producing a grounded answer from one private collection.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AnswerWithSourcesInput {
    /// Public ID of the collection to search.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// User question that should be answered from indexed knowledge.
    pub question: String,
}

/// Arguments for adding knowledge and checking whether ingestion succeeds.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IngestAndVerifyInput {
    /// Public ID of the collection that should receive the content.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Text or URL the user intends to ingest.
    pub content: String,
}

/// Arguments for diagnosing one failed or stalled ingestion.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct InvestigateIngestionFailureInput {
    /// Public ID of the collection that contains the ingestion.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the ingestion to investigate.
    #[schemars(with = "String")]
    pub ingestion_id: PublicId<IngestionId>,
}

/// Arguments for synchronizing one connector source and reviewing its result.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SyncSourceAndReviewInput {
    /// Public ID of the collection that contains the source.
    #[schemars(with = "String")]
    pub collection_id: PublicId<CollectionId>,

    /// Public ID of the connector source the user intends to synchronize.
    #[schemars(with = "String")]
    pub source_id: PublicId<SourceId>,
}

#[prompt_router(vis = "pub(crate)")]
impl Mcp {
    /// Produces instructions for a grounded answer with citations.
    #[prompt(
        name = "answer_with_sources",
        description = "Search private knowledge, follow focused evidence links only when needed, cite document locations, and say clearly when the indexed corpus does not support an answer."
    )]
    async fn answer_with_sources(
        &self,
        Parameters(args): Parameters<AnswerWithSourcesInput>,
    ) -> Vec<PromptMessage> {
        vec![PromptMessage::new_text(
            PromptMessageRole::User,
            include_str!("assets/skills/answer-with-sources.md")
                .replace("{{collection_id}}", &args.collection_id.to_string())
                .replace("{{question}}", &args.question),
        )]
    }

    /// Produces instructions for explicit ingestion followed by verification.
    #[prompt(
        name = "ingest_and_verify",
        description = "Add text or a URL only after explicit user intent, inspect asynchronous ingestion status, and summarize acceptance or failure."
    )]
    async fn ingest_and_verify(
        &self,
        Parameters(args): Parameters<IngestAndVerifyInput>,
    ) -> Vec<PromptMessage> {
        vec![PromptMessage::new_text(
            PromptMessageRole::User,
            include_str!("assets/skills/ingest-and-verify.md")
                .replace("{{collection_id}}", &args.collection_id.to_string())
                .replace("{{content}}", &args.content),
        )]
    }

    /// Produces instructions for diagnosing ingestion failure without automatic retries.
    #[prompt(
        name = "investigate_ingestion_failure",
        description = "Inspect ingestion state and diagnostic events, explain the likely failure, and recommend remediation without retrying automatically."
    )]
    async fn investigate_ingestion_failure(
        &self,
        Parameters(args): Parameters<InvestigateIngestionFailureInput>,
    ) -> Vec<PromptMessage> {
        vec![PromptMessage::new_text(
            PromptMessageRole::User,
            include_str!("assets/skills/investigate-ingestion-failure.md")
                .replace("{{collection_id}}", &args.collection_id.to_string())
                .replace("{{ingestion_id}}", &args.ingestion_id.to_string()),
        )]
    }

    /// Produces instructions for an explicitly requested connector synchronization.
    #[prompt(
        name = "sync_source_and_review",
        description = "Start an explicitly requested connector sync, inspect the asynchronous run, and summarize changed documents and failures."
    )]
    async fn sync_source_and_review(
        &self,
        Parameters(args): Parameters<SyncSourceAndReviewInput>,
    ) -> Vec<PromptMessage> {
        vec![PromptMessage::new_text(
            PromptMessageRole::User,
            include_str!("assets/skills/sync-source-and-review.md")
                .replace("{{collection_id}}", &args.collection_id.to_string())
                .replace("{{source_id}}", &args.source_id.to_string()),
        )]
    }
}
