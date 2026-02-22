CREATE TYPE "indexing_job_status" AS ENUM('pending', 'in_progress', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "fragment_index_jobs" (
	"job_id" uuid PRIMARY KEY DEFAULT gen_random_uuid_v7(),
	"doc_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" "indexing_job_status" DEFAULT 'pending'::"indexing_job_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "publish_gate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "publish_gate_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "publish_gate_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fragment_index_job_doc_ver" ON "fragment_index_jobs" ("doc_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_fragment_index_job_status_started" ON "fragment_index_jobs" ("status","started_at");--> statement-breakpoint
CREATE INDEX "idx_fragment_index_job_doc" ON "fragment_index_jobs" ("doc_id","version_id","status");--> statement-breakpoint
CREATE INDEX "idx_doc_publish_gate" ON "legal_documents" ("publish_gate");--> statement-breakpoint
CREATE INDEX "idx_doc_publish_gate_updated" ON "legal_documents" ("publish_gate_updated_at");--> statement-breakpoint
ALTER TABLE "fragment_index_jobs" ADD CONSTRAINT "fragment_index_jobs_doc_id_legal_documents_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "legal_documents"("doc_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fragment_index_jobs" ADD CONSTRAINT "fragment_index_jobs_GR2lKeltd578_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("version_id") ON DELETE CASCADE;