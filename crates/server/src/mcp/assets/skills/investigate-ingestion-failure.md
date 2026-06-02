# Investigate Ingestion Failure

Explain why one ingestion failed or stopped progressing.

Collection: `{{collection_id}}`

Ingestion: `{{ingestion_id}}`

Workflow:

1. Call `get_ingestion_status`.
2. Follow the ingestion event resource link when diagnostic context is needed.
3. Summarize the observed failure, the likely cause, and practical remediation.
4. Distinguish observed facts from inferences.

Do not retry ingestion automatically. Ask for user confirmation before starting
new work.
