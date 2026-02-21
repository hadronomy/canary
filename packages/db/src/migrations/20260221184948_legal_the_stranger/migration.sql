CREATE EXTENSION IF NOT EXISTS "ltree";--> statement-breakpoint
ALTER TABLE "sense_fragments" ADD COLUMN "node_path_ltree" ltree;--> statement-breakpoint
ALTER TABLE "sense_fragments" ADD COLUMN "legal_node_path_ltree" ltree;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_frag_doc_path_ltree" ON "sense_fragments" ("doc_id","node_path_ltree");--> statement-breakpoint
CREATE INDEX "idx_frag_node_path_ltree_gist" ON "sense_fragments" USING gist ("node_path_ltree");--> statement-breakpoint
CREATE INDEX "idx_frag_legal_node_path_ltree_gist" ON "sense_fragments" USING gist ("legal_node_path_ltree");
