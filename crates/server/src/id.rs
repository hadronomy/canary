//! UUIDv7-backed identifiers shared by server domain boundaries.
//!
//! Each identifier serializes through [`public_id::PublicId`] at an external
//! boundary. Keeping distinct domain types prevents a collection ID from being
//! accepted where a document, ingestion, or connector run ID is required.

use public_id::resource_id;

resource_id!(
    /// Identifies a private-knowledge collection.
    pub CollectionId,
    "col"
);

resource_id!(
    /// Identifies one source document in a collection.
    pub DocumentId,
    "doc"
);

resource_id!(
    /// Identifies one immutable document version.
    pub DocumentVersionId,
    "ver"
);

resource_id!(
    /// Identifies one retrieval chunk derived from a document.
    pub ChunkId,
    "chk"
);

resource_id!(
    /// Identifies one external connector source.
    pub SourceId,
    "src"
);

resource_id!(
    /// Identifies one asynchronous ingestion.
    pub IngestionId,
    "ing"
);

resource_id!(
    /// Identifies one source or schedule execution.
    pub RunId,
    "run"
);

resource_id!(
    /// Identifies one scheduled ingestion trigger.
    pub ScheduleId,
    "sch"
);

resource_id!(
    /// Identifies one durable asynchronous operation.
    pub OperationId,
    "op"
);

resource_id!(
    /// Identifies one diagnostic or audit event.
    pub EventId,
    "evt"
);
