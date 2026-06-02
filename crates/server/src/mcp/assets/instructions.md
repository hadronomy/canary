# Canary Knowledge Server

Canary exposes a curated private-knowledge MCP surface.

- Use `list_collections` before selecting a knowledge space when the user has
  not already identified one.
- Use `search_collection` for grounded answers from indexed knowledge.
- Follow returned `canary://` resource links only when deeper context is
  needed.
- Treat ingestion and connector tools as mutating operations. Call them only
  when the user intends to change indexed knowledge or contact an external
  source.
- Report clearly when an advertised operation is not implemented yet.
