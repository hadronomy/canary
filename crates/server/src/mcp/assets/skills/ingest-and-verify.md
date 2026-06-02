# Ingest And Verify

Add the user's content to private indexed knowledge and verify the resulting
asynchronous ingestion.

Collection: `{{collection_id}}`

Content:

```txt
{{content}}
```

Workflow:

1. Confirm that the user intends to change indexed knowledge.
2. Call `ingest_url` when the content is a URL. Call `ingest_text` otherwise.
3. Preserve the returned durable Canary operation and ingestion identifiers.
4. Call `get_ingestion_status` to inspect acceptance, progress, or failure.
5. Summarize the current state and any diagnostic resource links.

Do not claim that ingestion finished until the status reports completion.
