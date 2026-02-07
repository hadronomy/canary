import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

// ─── Enums ───
export const jurisdictionEnum = pgEnum("jurisdiction", [
  "estatal",
  "andalucia",
  "aragon",
  "asturias",
  "baleares",
  "canarias",
  "cantabria",
  "castilla_la_mancha",
  "castilla_y_leon",
  "cataluña",
  "extremadura",
  "galicia",
  "madrid",
  "murcia",
  "navarra",
  "pais_vasco",
  "rioja",
  "valencia",
  "ceuta",
  "melilla",
  "europea",
]);

export const legislativeStageEnum = pgEnum("legislative_stage", [
  "draft",
  "parliamentary",
  "bulletin",
  "approved",
  "enacted",
  "repealed",
  "expired",
]);

export const contentTypeEnum = pgEnum("content_type", [
  "draft_bill",
  "draft_proposal",
  "draft_amendment",
  "bulletin_item",
  "law",
  "regulation",
  "precedent",
  "doctrine",
]);

export const hierarchyEnum = pgEnum("hierarchy_level", [
  "constitucion",
  "tratado_internacional",
  "ley_organica",
  "ley_estatal",
  "real_decreto_legislativo",
  "real_decreto",
  "decreto_ley",
  "decreto",
  "orden_ministerial",
  "resolucion",
  "circular",
]);

export const nodeTypeEnum = pgEnum("node_type", [
  "document",
  "preambulo",
  "book",
  "title",
  "subtitle",
  "chapter",
  "section",
  "subsection",
  "article",
  "paragraph",
  "subparagraph",
  "point",
  "letter",
  "annex",
  "disposicion_transitoria",
  "disposicion_final",
  "nota_al_pie",
]);

export const relationTypeEnum = pgEnum("relation_type", [
  "deroga_total",
  "deroga_parcial",
  "modifica",
  "interpreta",
  "complementa",
  "transitoria",
  "cita_explicita",
  "cita_implicita",
  "glossa",
  "concordancia",
  "publicada_en",
]);

export const extractionMethodEnum = pgEnum("extraction_method", [
  "regex",
  "spacy_ner",
  "transformer_ner",
  "llm_gpt4",
  "llm_claude",
  "manual_human",
  "admin_override",
  "imported",
]);

export const embeddingModelEnum = pgEnum("embedding_model", [
  "jina-embeddings-v4",
  "openai_3_large",
  "openai_3_small",
  "e5_multilingual",
  "custom",
]);

// ─── 1. Legislative Sources ───
export const legislativeSources = pgTable(
  "legislative_sources",
  {
    sourceId: uuid("source_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),

    sourceCode: varchar("source_code", { length: 50 }).notNull().unique(),
    sourceName: varchar("source_name", { length: 200 }).notNull(),
    shortName: varchar("short_name", { length: 50 }),
    description: text("description"),

    jurisdiction: jurisdictionEnum("jurisdiction").notNull(),
    autonomousCommunity: varchar("autonomous_community", { length: 50 }),
    isParliamentary: boolean("is_parliamentary").default(false),
    isOfficialGazette: boolean("is_official_gazette").default(false),
    providesStage: legislativeStageEnum("provides_stage").notNull().array(),

    baseUrl: text("base_url"),
    apiConfig: jsonb("api_config").default({}),

    activatedAt: timestamp("activated_at", { withTimezone: true }).defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedReason: varchar("deactivated_reason", { length: 200 }),

    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", {
      withTimezone: true,
    }),
    lastFailedSyncAt: timestamp("last_failed_sync_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_source_code").on(table.sourceCode),
    index("idx_source_jurisdiction").on(table.jurisdiction),
    index("idx_source_active")
      .on(table.deactivatedAt)
      .where(sql`${table.deactivatedAt} IS NULL`),
  ],
);

// ─── 2. Legal Documents ───
export const legalDocuments = pgTable(
  "legal_documents",
  {
    docId: uuid("doc_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),

    sourceId: uuid("source_id")
      .references(() => legislativeSources.sourceId)
      .notNull(),

    canonicalId: varchar("canonical_id", { length: 150 }).notNull(),
    eliUri: text("eli_uri"),

    shortSlug: varchar("short_slug", { length: 21 })
      .unique()
      .default(sql`generate_nanoid(21)`),

    contentType: contentTypeEnum("content_type").notNull(),
    legislativeStage: legislativeStageEnum("legislative_stage").notNull(),
    hierarchyLevel: hierarchyEnum("hierarchy_level"),

    officialTitle: text("official_title").notNull(),
    shortTitle: varchar("short_title", { length: 300 }),
    acronym: varchar("acronym", { length: 20 }),

    draftNumber: varchar("draft_number", { length: 50 }),
    proceduralStatus: varchar("procedural_status", { length: 50 }),
    parliamentaryPeriod: varchar("parliamentary_period", { length: 20 }),
    parliamentarySession: varchar("parliamentary_session", { length: 50 }),

    introducedAt: timestamp("introduced_at", { withTimezone: true }),
    debatedAt: timestamp("debated_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    entryIntoForceAt: timestamp("entry_into_force_at", {
      withTimezone: true,
    }),
    repealedAt: timestamp("repealed_at", { withTimezone: true }),
    repealedByDocId: uuid("repealed_by_doc_id").references((): AnyPgColumn => legalDocuments.docId),

    isConsolidatedText: boolean("is_consolidated_text").default(false),
    consolidationDate: timestamp("consolidation_date", { withTimezone: true }),
    consolidatesDocId: uuid("consolidates_doc_id").references(
      (): AnyPgColumn => legalDocuments.docId,
    ),

    parentBulletinId: uuid("parent_bulletin_id").references(
      (): AnyPgColumn => legalDocuments.docId,
    ),
    bulletinSection: varchar("bulletin_section", { length: 100 }),
    bulletinPage: varchar("bulletin_page", { length: 20 }),

    originalTextUrl: text("original_text_url"),
    debateTranscriptUrl: text("debate_transcript_url"),
    enactedTextUrl: text("enacted_text_url"),
    pdfUrl: text("pdf_url"),
    xmlUrl: text("xml_url"),

    rawMetadata: jsonb("raw_metadata").default({}),
    department: varchar("department", { length: 200 }),
    proposerType: varchar("proposer_type", { length: 50 }),
    proposerName: varchar("proposer_name", { length: 200 }),

    contentHash: varchar("content_hash", { length: 64 }),
    metadataHash: varchar("metadata_hash", { length: 64 }),

    summaryEmbedding: vector("summary_embedding", { dimensions: 256 }),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
    lastUpdatedAt: timestamp("last_updated_at", {
      withTimezone: true,
    }).defaultNow(),

    createdBy: varchar("created_by", { length: 100 }),
    updatedBy: varchar("updated_by", { length: 100 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_doc_canonical").on(table.canonicalId),
    uniqueIndex("idx_doc_slug").on(table.shortSlug),
    index("idx_doc_stage").on(table.legislativeStage, table.contentType),
    index("idx_doc_bulletin").on(table.parentBulletinId),
    index("idx_doc_vector_hnsw").using("hnsw", table.summaryEmbedding.op("vector_cosine_ops")),
  ],
);

// ─── 3. Document Versions ───
export const documentVersions = pgTable(
  "document_versions",
  {
    versionId: uuid("version_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),
    docId: uuid("doc_id")
      .references(() => legalDocuments.docId, { onDelete: "cascade" })
      .notNull(),
    versionNumber: integer("version_number").notNull(),
    versionType: varchar("version_type", { length: 50 }).notNull(),
    contentText: text("content_text"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [uniqueIndex("idx_version_doc_num").on(table.docId, table.versionNumber)],
);

// ─── 4. Legislative Events (ULID) ───
export const legislativeEvents = pgTable(
  "legislative_events",
  {
    eventId: varchar("event_id", { length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    docId: uuid("doc_id")
      .references(() => legalDocuments.docId, { onDelete: "cascade" })
      .notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    outcome: varchar("outcome", { length: 50 }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("idx_event_doc").on(table.docId, table.occurredAt)],
);

// ─── 5. Sense Fragments ───
export const senseFragments = pgTable(
  "sense_fragments",
  {
    fragmentId: uuid("fragment_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),
    docId: uuid("doc_id")
      .references(() => legalDocuments.docId, { onDelete: "cascade" })
      .notNull(),
    versionId: uuid("version_id").references(() => documentVersions.versionId),

    content: text("content").notNull(),
    contentNormalized: text("content_normalized"),
    nodePath: varchar("node_path", { length: 500 }).notNull(),
    nodeType: nodeTypeEnum("node_type").notNull(),
    nodeNumber: varchar("node_number", { length: 50 }),
    nodeTitle: varchar("node_title", { length: 500 }),

    precedingContext: text("preceding_context"),
    followingContext: text("following_context"),

    embedding1024: vector("embedding_1024", { dimensions: 1024 }),
    embedding256: vector("embedding_256", { dimensions: 256 }),

    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),

    tokenCount: integer("token_count"),
    charCount: integer("char_count"),
    wordCount: integer("word_count"),
    sequenceIndex: integer("sequence_index"),
    contentFingerprint: varchar("content_fingerprint", { length: 64 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_frag_doc_path").on(table.docId, table.nodePath),
    index("idx_frag_256_hnsw")
      .using("hnsw", table.embedding256.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("idx_frag_1024_hnsw")
      .using("hnsw", table.embedding1024.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("idx_frag_doc_version").on(table.docId, table.versionId),
    index("idx_frag_node_type").on(table.nodeType),
    index("idx_frag_valid_window").on(table.validFrom, table.validUntil),
    uniqueIndex("idx_frag_doc_fingerprint").on(table.docId, table.contentFingerprint),
  ],
);

// ─── 6. Reference Anchors (ULID) ───
export const referenceAnchors = pgTable(
  "reference_anchors",
  {
    anchorId: varchar("anchor_id", { length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    sourceFragmentId: uuid("source_fragment_id").references(() => senseFragments.fragmentId, {
      onDelete: "cascade",
    }),
    sourceDocId: uuid("source_doc_id")
      .references(() => legalDocuments.docId, { onDelete: "cascade" })
      .notNull(),
    targetCanonicalId: varchar("target_canonical_id", { length: 150 }).notNull(),
    targetDocId: uuid("target_doc_id").references(() => legalDocuments.docId),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    relationType: relationTypeEnum("relation_type").notNull(),
    extractionConfidence: real("extraction_confidence"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validatedBy: varchar("validated_by", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_ref_source_doc").on(table.sourceDocId, table.relationType),
    index("idx_ref_unresolved")
      .on(table.sourceDocId)
      .where(sql`${table.targetDocId} IS NULL`),
  ],
);

// ─── 7. Legal Paths ───
export const legalPaths = pgTable(
  "legal_paths",
  {
    pathId: uuid("path_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),
    startDocId: uuid("start_doc_id")
      .references(() => legalDocuments.docId)
      .notNull(),
    endDocId: uuid("end_doc_id")
      .references(() => legalDocuments.docId)
      .notNull(),
    pathType: varchar("path_type", { length: 50 }).notNull(),
    pathLength: integer("path_length").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_path_endpoints").on(table.startDocId, table.endDocId, table.pathType),
  ],
);

// ─── 8. Query Cache (NanoID) ───
export const queryCacheEntries = pgTable(
  "query_cache_entries",
  {
    cacheId: varchar("cache_id", { length: 32 })
      .primaryKey()
      .default(sql`generate_nanoid(32)`),
    queryHash: varchar("query_hash", { length: 64 }).notNull().unique(),
    queryText: text("query_text").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_cache_hash").on(table.queryHash),
    index("idx_cache_ttl").on(table.expiresAt),
  ],
);

// ─── 9. Audit Log (ULID) ───
export const auditLog = pgTable(
  "audit_logs",
  {
    logId: varchar("log_id", { length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    actorId: varchar("actor_id", { length: 100 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").default({}),
  },
  (table) => [
    index("idx_audit_entity").on(table.entityType, table.entityId, table.occurredAt),
    sql`CREATE INDEX idx_audit_time_brin ON ${table} USING BRIN (${table.occurredAt})`,
  ],
);

// ─── 10. Sync Runs ───
export const syncRuns = pgTable(
  "sync_runs",
  {
    runId: uuid("run_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),
    sourceId: uuid("source_id")
      .references(() => legislativeSources.sourceId)
      .notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    docsInserted: integer("docs_inserted").default(0),
    docsUpdated: integer("docs_updated").default(0),
    docsFailed: integer("docs_failed").default(0),
    durationMs: integer("duration_ms"),
    errorLog: jsonb("error_log").default([]),
    metadata: jsonb("metadata").default({}),
  },
  (table) => [index("idx_sync_source_time").on(table.sourceId, table.startedAt)],
);

// ─── 11. Embeddings Cache ───
export const embeddingCache = pgTable(
  "embedding_cache",
  {
    embeddingId: uuid("embedding_id")
      .primaryKey()
      .default(sql`gen_random_uuid_v7()`),
    fragmentId: uuid("fragment_id")
      .references(() => senseFragments.fragmentId, { onDelete: "cascade" })
      .notNull(),
    modelName: embeddingModelEnum("model_name").notNull(),
    dimensions: integer("dimensions").notNull(),
    embeddingVector: vector("embedding_vector", { dimensions: 1536 }),
    embeddingBinary: jsonb("embedding_binary"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow(),
    computeDurationMs: integer("compute_duration_ms"),
  },
  (table) => [
    uniqueIndex("idx_embedding_fragment_model").on(table.fragmentId, table.modelName),
    index("idx_embedding_vector_hnsw").using("hnsw", table.embeddingVector.op("vector_cosine_ops")),
    check(
      "chk_embeddings_model_dims",
      sql`(
        (${table.modelName} = 'jina-embeddings-v4' and ${table.dimensions} in (256, 1024, 1536))
        or (${table.modelName} = 'openai_3_small' and ${table.dimensions} in (256, 1024, 1536))
        or (${table.modelName} = 'openai_3_large' and ${table.dimensions} in (256, 1024, 1536))
        or (${table.modelName} = 'e5_multilingual' and ${table.dimensions} in (256, 384, 768, 1024))
        or (${table.modelName} = 'custom' and ${table.dimensions} > 0 and ${table.dimensions} <= 1536)
      )`,
    ),
  ],
);

// ─── Relations ───
export const legislativeSourcesRelations = relations(legislativeSources, ({ many }) => ({
  documents: many(legalDocuments),
  syncRuns: many(syncRuns),
}));

export const legalDocumentsRelations = relations(legalDocuments, ({ one, many }) => ({
  source: one(legislativeSources, {
    fields: [legalDocuments.sourceId],
    references: [legislativeSources.sourceId],
  }),
  fragments: many(senseFragments),
  versions: many(documentVersions),
  events: many(legislativeEvents),
  outgoingAnchors: many(referenceAnchors, { relationName: "sourceRefs" }),
  incomingAnchors: many(referenceAnchors, { relationName: "targetRefs" }),
  parentBulletin: one(legalDocuments, {
    fields: [legalDocuments.parentBulletinId],
    references: [legalDocuments.docId],
  }),
  repealedBy: one(legalDocuments, {
    fields: [legalDocuments.repealedByDocId],
    references: [legalDocuments.docId],
  }),
  consolidates: one(legalDocuments, {
    fields: [legalDocuments.consolidatesDocId],
    references: [legalDocuments.docId],
  }),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one, many }) => ({
  document: one(legalDocuments, {
    fields: [documentVersions.docId],
    references: [legalDocuments.docId],
  }),
  fragments: many(senseFragments),
}));

export const legislativeEventsRelations = relations(legislativeEvents, ({ one }) => ({
  document: one(legalDocuments, {
    fields: [legislativeEvents.docId],
    references: [legalDocuments.docId],
  }),
}));

export const senseFragmentsRelations = relations(senseFragments, ({ one, many }) => ({
  document: one(legalDocuments, {
    fields: [senseFragments.docId],
    references: [legalDocuments.docId],
  }),
  version: one(documentVersions, {
    fields: [senseFragments.versionId],
    references: [documentVersions.versionId],
  }),
  outgoingAnchors: many(referenceAnchors, { relationName: "fragmentSourceRefs" }),
  embeddings: many(embeddingCache),
}));

export const referenceAnchorsRelations = relations(referenceAnchors, ({ one }) => ({
  sourceDoc: one(legalDocuments, {
    fields: [referenceAnchors.sourceDocId],
    references: [legalDocuments.docId],
    relationName: "sourceRefs",
  }),
  targetDoc: one(legalDocuments, {
    fields: [referenceAnchors.targetDocId],
    references: [legalDocuments.docId],
    relationName: "targetRefs",
  }),
  sourceFragment: one(senseFragments, {
    fields: [referenceAnchors.sourceFragmentId],
    references: [senseFragments.fragmentId],
    relationName: "fragmentSourceRefs",
  }),
}));

export const legalPathsRelations = relations(legalPaths, ({ one }) => ({
  startDoc: one(legalDocuments, {
    fields: [legalPaths.startDocId],
    references: [legalDocuments.docId],
  }),
  endDoc: one(legalDocuments, {
    fields: [legalPaths.endDocId],
    references: [legalDocuments.docId],
  }),
}));

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  source: one(legislativeSources, {
    fields: [syncRuns.sourceId],
    references: [legislativeSources.sourceId],
  }),
}));

export const embeddingCacheRelations = relations(embeddingCache, ({ one }) => ({
  fragment: one(senseFragments, {
    fields: [embeddingCache.fragmentId],
    references: [senseFragments.fragmentId],
  }),
}));

// ─── Types ───
export type LegislativeSource = typeof legislativeSources.$inferSelect;
export type NewLegislativeSource = typeof legislativeSources.$inferInsert;

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type NewLegalDocument = typeof legalDocuments.$inferInsert;

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;

export type LegislativeEvent = typeof legislativeEvents.$inferSelect;
export type NewLegislativeEvent = typeof legislativeEvents.$inferInsert;

export type SenseFragment = typeof senseFragments.$inferSelect;
export type NewSenseFragment = typeof senseFragments.$inferInsert;

export type ReferenceAnchor = typeof referenceAnchors.$inferSelect;
export type NewReferenceAnchor = typeof referenceAnchors.$inferInsert;

export type LegalPath = typeof legalPaths.$inferSelect;
export type NewLegalPath = typeof legalPaths.$inferInsert;

export type QueryCacheEntry = typeof queryCacheEntries.$inferSelect;
export type NewQueryCacheEntry = typeof queryCacheEntries.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;

export type EmbeddingsCacheEntry = typeof embeddingCache.$inferSelect;
export type NewEmbeddingsCacheEntry = typeof embeddingCache.$inferInsert;

// ─── Enums Types ───
export type Jurisdiction = (typeof jurisdictionEnum.enumValues)[number];
export type LegislativeStage = (typeof legislativeStageEnum.enumValues)[number];
export type ContentType = (typeof contentTypeEnum.enumValues)[number];
export type HierarchyLevel = (typeof hierarchyEnum.enumValues)[number];
export type NodeType = (typeof nodeTypeEnum.enumValues)[number];
export type RelationType = (typeof relationTypeEnum.enumValues)[number];
export type ExtractionMethod = (typeof extractionMethodEnum.enumValues)[number];
export type EmbeddingModel = (typeof embeddingModelEnum.enumValues)[number];
