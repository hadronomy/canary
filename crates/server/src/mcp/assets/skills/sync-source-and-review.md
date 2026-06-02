# Sync Source And Review

Synchronize one external connector source and review the resulting changes.

Collection: `{{collection_id}}`

Source: `{{source_id}}`

Workflow:

1. Confirm that the user intends to contact the external source and update
   indexed knowledge.
2. Call `run_source_sync`.
3. Preserve the returned durable Canary operation and source-run identifiers.
4. Call `get_source_run_status` to inspect progress, changed-document counts,
   and failures.
5. Summarize the current state and any follow-up that needs user attention.

Do not claim that synchronization finished until the run status reports a
terminal state.
