# TODO: Chunking for Reference Anchor Population

## Context

The `populateReferenceAnchorsForAllSourceDocuments` function in `apps/server/src/collectors/boe/factory.ts` currently processes all source documents in a single batch when populating reference anchors.

## The TODO

```typescript
// TODO: Make this work in chunks like with all the other elements
const populateReferenceAnchorsForAllSourceDocuments = Effect.fn(
  "BoeCollector.populateReferenceAnchorsForAllSourceDocuments",
)((runId: CollectionRunId) =>
  Effect.gen(function* () {
    // ... loads ALL latest versions at once
  }),
);
```

## Why This Matters

1. **Memory Usage**: Loading all document versions into memory at once can cause OOM errors with large document sets
2. **Timeout Risk**: Long-running operations may hit database or HTTP timeout limits
3. **Resumability**: If the process fails partway through, we lose progress
4. **Consistency**: Other collection operations use chunking for similar batch operations

## Current Implementation

The function currently:

1. Loads all latest document versions for the source in a single query
2. Parses each document's XML to extract references
3. Upserts reference anchors into the database

## Solution Approach

Following the pattern used by other chunked operations in the codebase:

1. Use `Effect.forEach` with `batchSize` option
2. Process documents in manageable chunks (e.g., 100-500 at a time)
3. Add checkpoint/logging between chunks
4. Consider adding a resume mechanism for failed chunks

## Related TODOs

There's also a related TODO in the same file:

```typescript
// TODO: This should be done in chunks as well to avoid potential timeouts
// and memory issues with large numbers of documents
yield *
  populateReferenceAnchorsForAllSourceDocuments(runId)
    .pipe
    // ...
    ();
```

## Implementation Location

- File: `apps/server/src/collectors/boe/factory.ts`
- Function: `populateReferenceAnchorsForAllSourceDocuments`
- Lines: ~910-1040

## See Also

- `ingestDocumentVersions` - uses chunking pattern
- `updateDocumentVersions` - uses chunking pattern
- `resolveReferenceAnchorsForCollectorRun` - similar batch operation
