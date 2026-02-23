## Lexical Prefiltering at Corpus Scale

For the retrieval pipeline, keep lexical matching as a post-ANN rescoring signal by default.
If you later want lexical prefiltering at corpus scale, add either:

1. A `GIN` `tsvector` index on `official_title` and `node_title`.
2. A `pg_trgm` index for fuzzy title matching.

Use lexical prefilters carefully, because they can suppress semantically relevant candidates when the query wording is noisy.
