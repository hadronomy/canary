# Answer With Sources

Answer the user's question from private indexed knowledge.

Collection: `{{collection_id}}`

Question:

```txt
{{question}}
```

Workflow:

1. Call `search_collection` with the collection ID and question.
2. Use the returned excerpts as the primary grounding evidence.
3. Follow focused `canary://` chunk or document links only when the excerpts do
   not provide enough context.
4. Answer with citations that name the document and source location whenever a
   location is available.
5. Say clearly when the indexed corpus does not support a reliable answer.

Do not invent facts that are absent from the retrieved evidence.
