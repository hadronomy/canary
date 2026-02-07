DROP INDEX "idx_frag_fingerprint";--> statement-breakpoint
CREATE INDEX "idx_frag_1024_hnsw" ON "sense_fragments" USING hnsw ("embedding_1024" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "idx_frag_doc_version" ON "sense_fragments" USING btree ("doc_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_frag_node_type" ON "sense_fragments" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "idx_frag_valid_window" ON "sense_fragments" USING btree ("valid_from","valid_until");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_frag_doc_fingerprint" ON "sense_fragments" USING btree ("doc_id","content_fingerprint");--> statement-breakpoint
ALTER TABLE "embeddings_cache" ADD CONSTRAINT "chk_embeddings_model_dims" CHECK ((
        ("embeddings_cache"."model_name" = 'jina-embeddings-v4' and "embeddings_cache"."dimensions" in (256, 1024, 1536))
        or ("embeddings_cache"."model_name" = 'openai_3_small' and "embeddings_cache"."dimensions" in (256, 1024, 1536))
        or ("embeddings_cache"."model_name" = 'openai_3_large' and "embeddings_cache"."dimensions" in (256, 1024, 1536))
        or ("embeddings_cache"."model_name" = 'e5_multilingual' and "embeddings_cache"."dimensions" in (256, 384, 768, 1024))
        or ("embeddings_cache"."model_name" = 'custom' and "embeddings_cache"."dimensions" > 0 and "embeddings_cache"."dimensions" <= 1536)
      ));