## Use reference anchors for query

In this codebase the table is reference_anchors (not reference_fragments), and it’s the right mechanism to bridge:

- Constitution article hits (seed)
- -> to laws that modify/derogate them (like boe:BOE-A-2015-3439)
  So for your penal-reform query, relying only on semantic similarity is weaker than following reference edges. The ideal ranking should combine:

1. semantic seed retrieval, and
2. reference expansion via reference*anchors (relation_type in ('modifica', 'deroga*\*')), with time/context weighting.
   That’s the clean way to make reform laws surface reliably when they are legally connected.
