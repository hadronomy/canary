use public_id::{PublicId, ResourceId};
use serde::{Deserialize, Serialize};
use smol_str::SmolStr;

/// Operation a principal wants to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Read an existing resource.
    Read,
    /// Create a new resource.
    Create,
    /// Update an existing resource.
    Update,
    /// Delete an existing resource.
    Delete,
    /// Cancel a running operation.
    Cancel,
    /// Trigger a scheduled or external operation.
    Trigger,
    /// Perform administrator-only work.
    Admin,
}

impl Action {
    /// Returns the action token used in Canary scopes.
    #[must_use]
    #[inline(always)]
    pub fn as_scope_token(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Create => "create",
            Self::Update => "update",
            Self::Delete => "delete",
            Self::Cancel => "cancel",
            Self::Trigger => "trigger",
            Self::Admin => "admin",
        }
    }
}

/// Kind of Canary resource used in authorization decisions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    /// REST API subtree.
    Api,
    /// MCP transport and protocol surface.
    Mcp,
    /// MCP tool invocation.
    McpTool,
    /// MCP resource read.
    McpResource,
    /// Private knowledge collection.
    Collection,
    /// Source document.
    Document,
    /// Immutable document version.
    DocumentVersion,
    /// Retrieval chunk.
    Chunk,
    /// External connector source.
    Source,
    /// Ingestion operation.
    Ingestion,
    /// Source or schedule run.
    Run,
    /// Scheduled ingestion trigger.
    Schedule,
    /// Durable async operation.
    Operation,
    /// Stored file.
    File,
}

impl ResourceKind {
    /// Returns the resource token used in Canary scopes.
    #[must_use]
    #[inline(always)]
    pub fn as_scope_token(self) -> &'static str {
        match self {
            Self::Api => "api",
            Self::Mcp => "mcp",
            Self::McpTool => "mcp_tool",
            Self::McpResource => "mcp_resource",
            Self::Collection => "collection",
            Self::Document => "document",
            Self::DocumentVersion => "document_version",
            Self::Chunk => "chunk",
            Self::Source => "source",
            Self::Ingestion => "ingestion",
            Self::Run => "run",
            Self::Schedule => "schedule",
            Self::Operation => "operation",
            Self::File => "file",
        }
    }
}

/// Public identifier paired with the resource kind expected by authorization.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ResourceKey {
    kind: ResourceKind,
    id: SmolStr,
}

impl ResourceKey {
    /// Creates a resource key from a typed public id.
    #[must_use]
    pub fn public<T: ResourceId>(kind: ResourceKind, id: PublicId<T>) -> Self {
        Self { kind, id: id.to_string().into() }
    }

    /// Returns the resource kind.
    #[must_use]
    #[inline(always)]
    pub fn kind(&self) -> ResourceKind {
        self.kind
    }

    /// Returns the public identifier text.
    #[must_use]
    #[inline(always)]
    pub fn id(&self) -> &str {
        self.id.as_str()
    }
}

/// Resource being protected.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Resource {
    /// REST API surface as a whole.
    Api,
    /// MCP surface as a whole.
    Mcp,
    /// One MCP tool.
    McpTool { name: SmolStr },
    /// One MCP resource URI.
    McpResource { uri: SmolStr },
    /// One collection.
    Collection { collection: ResourceKey },
    /// One document inside a collection.
    Document { collection: ResourceKey, document: ResourceKey },
    /// One document version inside a document.
    DocumentVersion { collection: ResourceKey, document: ResourceKey, version: ResourceKey },
    /// One retrieval chunk inside a collection.
    Chunk { collection: ResourceKey, chunk: ResourceKey },
    /// One connector source inside a collection.
    Source { collection: ResourceKey, source: ResourceKey },
    /// One ingestion inside a collection.
    Ingestion { collection: ResourceKey, ingestion: ResourceKey },
    /// One run owned by a source or schedule.
    Run { owner: ResourceKey, run: ResourceKey },
    /// One schedule.
    Schedule { schedule: ResourceKey },
    /// One durable operation.
    Operation { operation: ResourceKey },
    /// One stored file.
    File { file: ResourceKey },
}

impl Resource {
    /// REST API surface.
    #[must_use]
    #[inline(always)]
    pub fn api() -> Self {
        Self::Api
    }

    /// MCP surface.
    #[must_use]
    #[inline(always)]
    pub fn mcp() -> Self {
        Self::Mcp
    }

    /// Returns the broad resource kind used by scope checks.
    #[must_use]
    pub fn kind(&self) -> ResourceKind {
        match self {
            Self::Api => ResourceKind::Api,
            Self::Mcp => ResourceKind::Mcp,
            Self::McpTool { .. } => ResourceKind::McpTool,
            Self::McpResource { .. } => ResourceKind::McpResource,
            Self::Collection { .. } => ResourceKind::Collection,
            Self::Document { .. } => ResourceKind::Document,
            Self::DocumentVersion { .. } => ResourceKind::DocumentVersion,
            Self::Chunk { .. } => ResourceKind::Chunk,
            Self::Source { .. } => ResourceKind::Source,
            Self::Ingestion { .. } => ResourceKind::Ingestion,
            Self::Run { .. } => ResourceKind::Run,
            Self::Schedule { .. } => ResourceKind::Schedule,
            Self::Operation { .. } => ResourceKind::Operation,
            Self::File { .. } => ResourceKind::File,
        }
    }
}

/// Authorization decision for one principal, action, and resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// The principal may perform the action.
    Allow,
    /// The principal may not perform the action.
    Deny(Denial),
}

impl Decision {
    /// Returns whether the decision allows the action.
    #[must_use]
    #[inline(always)]
    pub fn is_allowed(&self) -> bool {
        matches!(self, Self::Allow)
    }
}

/// Why authorization was denied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Denial {
    /// The principal did not carry any acceptable scope.
    InsufficientScope {
        /// Scope tokens that would satisfy the policy.
        required: crate::ScopeSet,
    },
    /// The resource relationship did not satisfy containment checks.
    Containment,
}
