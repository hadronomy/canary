CREATE TYPE "content_type" AS ENUM('draft_bill', 'draft_proposal', 'draft_amendment', 'bulletin_item', 'law', 'regulation', 'precedent', 'doctrine');--> statement-breakpoint
CREATE TYPE "embedding_model" AS ENUM('jina-embeddings-v4', 'openai_3_large', 'openai_3_small', 'e5_multilingual', 'custom');--> statement-breakpoint
CREATE TYPE "extraction_method" AS ENUM('regex', 'spacy_ner', 'transformer_ner', 'llm_gpt4', 'llm_claude', 'manual_human', 'admin_override', 'imported');--> statement-breakpoint
CREATE TYPE "hierarchy_level" AS ENUM('constitucion', 'tratado_internacional', 'ley_organica', 'ley_estatal', 'real_decreto_legislativo', 'real_decreto', 'decreto_ley', 'decreto', 'orden_ministerial', 'resolucion', 'circular');--> statement-breakpoint
CREATE TYPE "jurisdiction" AS ENUM('estatal', 'andalucia', 'aragon', 'asturias', 'baleares', 'canarias', 'cantabria', 'castilla_la_mancha', 'castilla_y_leon', 'cataluña', 'extremadura', 'galicia', 'madrid', 'murcia', 'navarra', 'pais_vasco', 'rioja', 'valencia', 'ceuta', 'melilla', 'europea');--> statement-breakpoint
CREATE TYPE "legislative_stage" AS ENUM('draft', 'parliamentary', 'bulletin', 'approved', 'enacted', 'repealed', 'expired');--> statement-breakpoint
CREATE TYPE "node_type" AS ENUM('document', 'preambulo', 'book', 'title', 'subtitle', 'chapter', 'section', 'subsection', 'article', 'paragraph', 'subparagraph', 'point', 'letter', 'annex', 'disposicion_transitoria', 'disposicion_final', 'nota_al_pie');--> statement-breakpoint
CREATE TYPE "relation_type" AS ENUM('deroga_total', 'deroga_parcial', 'modifica', 'interpreta', 'complementa', 'transitoria', 'cita_explicita', 'cita_implicita', 'glossa', 'concordancia', 'publicada_en');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"log_id" varchar(26) PRIMARY KEY DEFAULT generate_ulid(),
	"event_type" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" varchar(100),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"doc_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"version_type" varchar(50) NOT NULL,
	"content_text" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"embedding_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"fragment_id" uuid NOT NULL,
	"model_name" "embedding_model" NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding_vector" vector(1536),
	"embedding_binary" jsonb,
	"computed_at" timestamp with time zone DEFAULT now(),
	"compute_duration_ms" integer,
	CONSTRAINT "chk_embeddings_model_dims" CHECK ((
        ("model_name" = 'jina-embeddings-v4' and "dimensions" in (256, 1024, 1536))
        or ("model_name" = 'openai_3_small' and "dimensions" in (256, 1024, 1536))
        or ("model_name" = 'openai_3_large' and "dimensions" in (256, 1024, 1536))
        or ("model_name" = 'e5_multilingual' and "dimensions" in (256, 384, 768, 1024))
        or ("model_name" = 'custom' and "dimensions" > 0 and "dimensions" <= 1536)
      ))
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"doc_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"source_id" uuid NOT NULL,
	"canonical_id" varchar(150) NOT NULL,
	"eli_uri" text,
	"short_slug" varchar(21) DEFAULT generate_nanoid(21) UNIQUE,
	"content_type" "content_type" NOT NULL,
	"legislative_stage" "legislative_stage" NOT NULL,
	"hierarchy_level" "hierarchy_level",
	"official_title" text NOT NULL,
	"short_title" varchar(300),
	"acronym" varchar(20),
	"draft_number" varchar(50),
	"procedural_status" varchar(50),
	"parliamentary_period" varchar(20),
	"parliamentary_session" varchar(50),
	"introduced_at" timestamp with time zone,
	"debated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"entry_into_force_at" timestamp with time zone,
	"repealed_at" timestamp with time zone,
	"repealed_by_doc_id" uuid,
	"is_consolidated_text" boolean DEFAULT false,
	"consolidation_date" timestamp with time zone,
	"consolidates_doc_id" uuid,
	"parent_bulletin_id" uuid,
	"bulletin_section" varchar(100),
	"bulletin_page" varchar(20),
	"original_text_url" text,
	"debate_transcript_url" text,
	"enacted_text_url" text,
	"pdf_url" text,
	"xml_url" text,
	"raw_metadata" jsonb DEFAULT '{}',
	"department" varchar(200),
	"proposer_type" varchar(50),
	"proposer_name" varchar(200),
	"content_hash" varchar(64),
	"metadata_hash" varchar(64),
	"summary_embedding" vector(256),
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_updated_at" timestamp with time zone DEFAULT now(),
	"created_by" varchar(100),
	"updated_by" varchar(100),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legal_paths" (
	"path_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"start_doc_id" uuid NOT NULL,
	"end_doc_id" uuid NOT NULL,
	"path_type" varchar(50) NOT NULL,
	"path_length" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "legislative_events" (
	"event_id" varchar(26) PRIMARY KEY DEFAULT generate_ulid(),
	"doc_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" varchar(50),
	"metadata" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "legislative_sources" (
	"source_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"source_code" varchar(50) NOT NULL UNIQUE,
	"source_name" varchar(200) NOT NULL,
	"short_name" varchar(50),
	"description" text,
	"jurisdiction" "jurisdiction" NOT NULL,
	"autonomous_community" varchar(50),
	"is_parliamentary" boolean DEFAULT false,
	"is_official_gazette" boolean DEFAULT false,
	"provides_stage" "legislative_stage"[] NOT NULL,
	"base_url" text,
	"api_config" jsonb DEFAULT '{}',
	"activated_at" timestamp with time zone DEFAULT now(),
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" varchar(200),
	"last_successful_sync_at" timestamp with time zone,
	"last_failed_sync_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "query_cache_entries" (
	"cache_id" varchar(32) PRIMARY KEY DEFAULT generate_nanoid(32),
	"query_hash" varchar(64) NOT NULL UNIQUE,
	"query_text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reference_anchors" (
	"anchor_id" varchar(26) PRIMARY KEY DEFAULT generate_ulid(),
	"source_fragment_id" uuid,
	"source_doc_id" uuid NOT NULL,
	"target_canonical_id" varchar(150) NOT NULL,
	"target_doc_id" uuid,
	"resolved_at" timestamp with time zone,
	"relation_type" "relation_type" NOT NULL,
	"extraction_confidence" real,
	"validated_at" timestamp with time zone,
	"validated_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sense_fragments" (
	"fragment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"doc_id" uuid NOT NULL,
	"version_id" uuid,
	"content" text NOT NULL,
	"content_normalized" text,
	"node_path" varchar(500) NOT NULL,
	"node_type" "node_type" NOT NULL,
	"node_number" varchar(50),
	"node_title" varchar(500),
	"preceding_context" text,
	"following_context" text,
	"embedding_1024" vector(1024),
	"embedding_256" vector(256),
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"token_count" integer,
	"char_count" integer,
	"word_count" integer,
	"sequence_index" integer,
	"content_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"source_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"docs_inserted" integer DEFAULT 0,
	"docs_updated" integer DEFAULT 0,
	"docs_failed" integer DEFAULT 0,
	"duration_ms" integer,
	"error_log" jsonb DEFAULT '[]',
	"metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_version_doc_num" ON "document_versions" ("doc_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_embedding_fragment_model" ON "embedding_cache" ("fragment_id","model_name");--> statement-breakpoint
CREATE INDEX "idx_embedding_vector_hnsw" ON "embedding_cache" USING hnsw ("embedding_vector" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_doc_canonical" ON "legal_documents" ("canonical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_doc_slug" ON "legal_documents" ("short_slug");--> statement-breakpoint
CREATE INDEX "idx_doc_stage" ON "legal_documents" ("legislative_stage","content_type");--> statement-breakpoint
CREATE INDEX "idx_doc_bulletin" ON "legal_documents" ("parent_bulletin_id");--> statement-breakpoint
CREATE INDEX "idx_doc_vector_hnsw" ON "legal_documents" USING hnsw ("summary_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_path_endpoints" ON "legal_paths" ("start_doc_id","end_doc_id","path_type");--> statement-breakpoint
CREATE INDEX "idx_event_doc" ON "legislative_events" ("doc_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_code" ON "legislative_sources" ("source_code");--> statement-breakpoint
CREATE INDEX "idx_source_jurisdiction" ON "legislative_sources" ("jurisdiction");--> statement-breakpoint
CREATE INDEX "idx_source_active" ON "legislative_sources" ("deactivated_at") WHERE "deactivated_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cache_hash" ON "query_cache_entries" ("query_hash");--> statement-breakpoint
CREATE INDEX "idx_cache_ttl" ON "query_cache_entries" ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_ref_source_doc" ON "reference_anchors" ("source_doc_id","relation_type");--> statement-breakpoint
CREATE INDEX "idx_ref_unresolved" ON "reference_anchors" ("source_doc_id") WHERE "target_doc_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_frag_doc_path" ON "sense_fragments" ("doc_id","node_path");--> statement-breakpoint
CREATE INDEX "idx_frag_256_hnsw" ON "sense_fragments" USING hnsw ("embedding_256" vector_cosine_ops) WITH (m=16, ef_construction=64);--> statement-breakpoint
CREATE INDEX "idx_frag_1024_hnsw" ON "sense_fragments" USING hnsw ("embedding_1024" vector_cosine_ops) WITH (m=16, ef_construction=64);--> statement-breakpoint
CREATE INDEX "idx_frag_doc_version" ON "sense_fragments" ("doc_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_frag_node_type" ON "sense_fragments" ("node_type");--> statement-breakpoint
CREATE INDEX "idx_frag_valid_window" ON "sense_fragments" ("valid_from","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_frag_doc_fingerprint" ON "sense_fragments" ("doc_id","content_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_sync_source_time" ON "sync_runs" ("source_id","started_at");--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "legal_documents"("doc_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "embedding_cache" ADD CONSTRAINT "embedding_cache_fragment_id_sense_fragments_fragment_id_fkey" FOREIGN KEY ("fragment_id") REFERENCES "sense_fragments"("fragment_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_source_id_legislative_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "legislative_sources"("source_id");--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_repealed_by_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("repealed_by_doc_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_consolidates_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("consolidates_doc_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_parent_bulletin_id_legal_documents_doc_id_fkey" FOREIGN KEY ("parent_bulletin_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "legal_paths" ADD CONSTRAINT "legal_paths_start_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("start_doc_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "legal_paths" ADD CONSTRAINT "legal_paths_end_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("end_doc_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "legislative_events" ADD CONSTRAINT "legislative_events_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "legal_documents"("doc_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reference_anchors" ADD CONSTRAINT "reference_anchors_TitQe6ekhU71_fkey" FOREIGN KEY ("source_fragment_id") REFERENCES "sense_fragments"("fragment_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reference_anchors" ADD CONSTRAINT "reference_anchors_source_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("source_doc_id") REFERENCES "legal_documents"("doc_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reference_anchors" ADD CONSTRAINT "reference_anchors_target_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("target_doc_id") REFERENCES "legal_documents"("doc_id");--> statement-breakpoint
ALTER TABLE "sense_fragments" ADD CONSTRAINT "sense_fragments_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "legal_documents"("doc_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sense_fragments" ADD CONSTRAINT "sense_fragments_version_id_document_versions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("version_id");--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_id_legislative_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "legislative_sources"("source_id");
