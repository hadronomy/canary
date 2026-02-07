ALTER TABLE "audit_log" RENAME TO "audit_logs";--> statement-breakpoint
ALTER TABLE "embeddings_cache" RENAME TO "embedding_cache";--> statement-breakpoint
ALTER TABLE "query_cache" RENAME TO "query_cache_entries";--> statement-breakpoint
ALTER TABLE "query_cache_entries" DROP CONSTRAINT "query_cache_query_hash_unique";--> statement-breakpoint
ALTER TABLE "embedding_cache" DROP CONSTRAINT "chk_embeddings_model_dims";--> statement-breakpoint
ALTER TABLE "embedding_cache" DROP CONSTRAINT "embeddings_cache_fragment_id_sense_fragments_fragment_id_fk";
--> statement-breakpoint
ALTER TABLE "embedding_cache" ADD CONSTRAINT "embedding_cache_fragment_id_sense_fragments_fragment_id_fk" FOREIGN KEY ("fragment_id") REFERENCES "public"."sense_fragments"("fragment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_cache_entries" ADD CONSTRAINT "query_cache_entries_query_hash_unique" UNIQUE("query_hash");--> statement-breakpoint
ALTER TABLE "embedding_cache" ADD CONSTRAINT "chk_embeddings_model_dims" CHECK ((
        ("embedding_cache"."model_name" = 'jina-embeddings-v4' and "embedding_cache"."dimensions" in (256, 1024, 1536))
        or ("embedding_cache"."model_name" = 'openai_3_small' and "embedding_cache"."dimensions" in (256, 1024, 1536))
        or ("embedding_cache"."model_name" = 'openai_3_large' and "embedding_cache"."dimensions" in (256, 1024, 1536))
        or ("embedding_cache"."model_name" = 'e5_multilingual' and "embedding_cache"."dimensions" in (256, 384, 768, 1024))
        or ("embedding_cache"."model_name" = 'custom' and "embedding_cache"."dimensions" > 0 and "embedding_cache"."dimensions" <= 1536)
      ));