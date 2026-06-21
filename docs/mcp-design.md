# Canary MCP Server Design

Status: foundation scaffold implemented
Research completed: 2026-06-02

## 1. Purpose

Canary should expose a carefully curated Model Context Protocol (MCP) surface for
agents and agent runtimes.

The MCP surface is not a second representation of the REST API. REST exists for
humans and systems that need explicit resource-oriented operations. MCP exists
for agents that need a compact set of high-signal capabilities, useful resource
links, and reusable workflows.

The design goals are:

- use the official Rust MCP SDK where it fits cleanly;
- integrate into the existing Axum server without introducing a parallel HTTP
  stack;
- expose tools named and described for agent comprehension;
- use resources to keep tool responses compact while preserving access to
  deeper context;
- model agent skills as MCP prompts;
- preserve Canary's existing authorization, containment, audit, and durable
  operation boundaries;
- leave room for resumability, subscriptions, and horizontal scaling without
  prematurely implementing experimental protocol features.

## 2. Recommendation

Use [`rmcp`](https://docs.rs/crate/rmcp/latest), the official Rust MCP SDK:

```toml
rmcp = { version = "1.7", default-features = false, features = [
  "server",
  "macros",
  "transport-streamable-http-server",
] }
```

As of 2026-06-02, the current published release is `rmcp` `1.7.0`.

`rmcp` is the best fit for Canary because it is:

- maintained in the official
  [`modelcontextprotocol/rust-sdk`](https://github.com/modelcontextprotocol/rust-sdk)
  repository;
- Tokio-native;
- directly usable as a Tower service inside the existing Axum router;
- current with MCP protocol version `2025-11-25`;
- capable of typed tools, structured outputs, resources, resource templates,
  prompts, progress, cancellation, notifications, subscriptions, and
  experimental tasks;
- configurable for stateful or stateless Streamable HTTP;
- configurable with host and origin validation;
- extensible with an external session store for multi-instance recovery.

Only add optional `rmcp` features when Canary starts using them. For example,
enable binary content support only when resources need to emit blobs.

## 3. Alternatives Considered

### 3.1 `rust-mcp-sdk`

[`rust-mcp-sdk`](https://github.com/rust-mcp-stack/rust-mcp-sdk) is an active,
capable alternative. It supports Streamable HTTP, resumability, DNS rebinding
protection, server OAuth integrations, tasks, and a separate
[`rust-mcp-axum`](https://crates.io/crates/rust-mcp-axum) adapter.

It is a reasonable conventional choice, but it is not the preferred dependency
for Canary:

- it is not the official SDK;
- its default dependency surface is broader;
- its Axum adapter introduces another framework layer where `rmcp` can mount as
  a Tower service directly;
- its own README describes the project as under development and advises use at
  the caller's risk.

### 3.2 `turbomcp`

[`turbomcp`](https://github.com/Epistates/turbomcp) has a particularly pleasant
developer experience. Its strongest ideas are:

- progressive disclosure through visibility filtering;
- typed middleware;
- composable handlers;
- an Axum router export;
- a clean macro API.

Canary should borrow these design ideas where they improve its own thin MCP
layer. It should not adopt an additional framework abstraction when the
official SDK already provides the protocol foundation and Tower integration.

### 3.3 `prism-mcp-rs`

[`prism-mcp-rs`](https://github.com/prismworks-ai/prism-mcp-rs) is ambitious
and broad, but it is less convincing as Canary's baseline dependency than the
official SDK.

## 4. Protocol Surface

Canary should initially advertise:

- tools;
- resources;
- resource templates;
- prompts.

Canary should not initially advertise:

- sampling, because Canary is a knowledge substrate rather than a model
  runtime;
- elicitation, until Canary has a concrete interactive workflow that benefits
  from it;
- MCP tasks, until Canary's durable operations can back them correctly;
- dynamic tool-list notifications, until the available catalog genuinely
  changes during a client session.

Resources and prompts are first-class parts of the MCP design, not optional
decoration around tools.

## 5. Streamable HTTP Transport

Use MCP Streamable HTTP at:

```txt
/mcp
```

Keep MCP separate from `/v1`. MCP has its own protocol version negotiation,
session behavior, JSON-RPC messages, and streaming semantics.

The official transport requires one MCP endpoint that supports:

```txt
POST   /mcp
GET    /mcp
DELETE /mcp
```

`POST` carries client JSON-RPC messages. `GET` can open a Server-Sent Events
(SSE) stream for server-to-client messages. In stateful mode, `DELETE` allows a
client to explicitly terminate an MCP session.

The implemented scaffold exposes all three methods and records `DELETE /mcp`
in the API checklist.

Mount the SDK as a nested Tower service:

```rust
let service = StreamableHttpService::new(
    move || Ok(Mcp::new(state.clone())),
    LocalSessionManager::default().into(),
    config.with_cancellation_token(token),
);

Router::new().nest_service("/mcp", service)
```

Use stateful mode initially. It enables:

- SSE notifications;
- reconnectable streams;
- future resource subscriptions;
- future progress notifications;
- a clean path to resumability.

Start with `LocalSessionManager` while Canary is deployed as one server
instance. For a multi-instance deployment:

- add an external `SessionStore`;
- use secure, non-deterministic session IDs;
- bind stored session state to the authenticated principal;
- use ingress affinity for active streams;
- treat Canary operations as the durable source of truth, not MCP sessions.

Canary's `ShutdownCoordinator` owns a root `CancellationToken`. MCP registers
for coordinated cancellation with `shutdown.register()`, which returns an
isolated child token. A subsystem can cancel its own child without affecting
siblings, while a server shutdown closes every active MCP stream coherently.

## 6. HTTP Middleware Boundaries

The current HTTP middleware applies a finite Tower timeout and compression to
every route. That is appropriate for ordinary REST requests but not for
long-lived MCP SSE streams.

Split the middleware into shared and route-specific layers.

Shared layers for REST and MCP:

```txt
request IDs
request context
sensitive header redaction
tracing
panic handling
body limits
authentication
rate limiting
```

REST-specific layers:

```txt
finite request timeout
ordinary HTTP response compression
```

MCP-specific behavior:

```txt
no generic finite timeout around SSE streams
SSE keep-alive and retry configuration owned by rmcp
explicit verification of compression behavior for text/event-stream
```

This preserves Canary's existing observability while respecting MCP transport
semantics.

## 7. Authentication and Authorization

Every MCP HTTP request must be authenticated. Every tool call and resource read
must also be authorized independently.

Sessions are transport state. They must never become authentication.

For local development, Canary's existing actor-header mechanism can remain a
useful boundary. For a remote MCP deployment, use proper bearer-token
validation and MCP authorization metadata.

Required security behavior:

- validate the `Host` header;
- validate the `Origin` header when present;
- configure explicit allowed hosts for public deployments;
- configure explicit allowed browser origins when browser clients are
  supported;
- authorize every tool invocation;
- authorize every resource URI after parsing it;
- enforce collection containment for nested resources;
- rate-limit by principal and tool;
- sanitize outputs;
- avoid logging or returning secrets;
- preserve audit records for all mutating calls;
- validate that inbound tokens are intended for the MCP server;
- never forward the inbound MCP access token to connector APIs.

`rmcp::StreamableHttpService` preserves HTTP request parts in request-context
extensions after consuming the body. Use those extensions to make the
authenticated principal and request metadata available to handlers.

## 8. Agent-Oriented Tool Design

Tool names and descriptions should answer:

- when should the agent use this tool?
- when should it not use this tool?
- does the call modify state?
- can it interact with an external system?
- what compact result will the agent receive?
- which resource links can the agent follow for deeper context?

All tool inputs should use typed `Parameters<T>`. All structured tool outputs
should return `rmcp::Json<T>` so `rmcp` emits a JSON output schema.

Descriptions should be explicit. For example:

```txt
Search a collection of ingested documents and return grounded evidence with
document metadata, source locations, relevance scores, and resource links. Use
this when the user asks a question that may be answered from private or
previously ingested knowledge.
```

Tool outputs should be compact and stable:

- typed public IDs;
- statuses;
- bounded previews;
- cursors;
- citations;
- resource links;
- operation IDs for asynchronous work.

Do not return:

- raw embeddings;
- secret connector configuration;
- credentials;
- giant document bodies;
- unbounded search results;
- presigned object-store URLs unless a narrowly scoped user-facing workflow
  requires them.

### 8.1 Initial Tool Catalog

| Tool                    | Purpose                                                                      | Annotation profile                                               |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `list_collections`      | Discover knowledge collections the principal may read.                       | read-only, closed-world                                          |
| `search_collection`     | Search private indexed knowledge and return grounded evidence.               | read-only, closed-world                                          |
| `list_documents`        | Browse compact document summaries within a collection.                       | read-only, closed-world                                          |
| `get_document`          | Read compact document metadata and return resource links for deeper content. | read-only, closed-world                                          |
| `ingest_text`           | Add text knowledge and begin ingestion.                                      | additive, idempotent with key, closed-world                      |
| `ingest_url`            | Fetch a URL and begin ingestion.                                             | additive, idempotent with key, open-world                        |
| `reprocess_documents`   | Re-run ingestion for existing documents.                                     | additive derived-state update, idempotent with key, closed-world |
| `get_ingestion_status`  | Inspect ingestion state, progress, and event links.                          | read-only, closed-world                                          |
| `list_sources`          | Discover configured connector sources.                                       | read-only, closed-world                                          |
| `run_source_sync`       | Start an incremental connector synchronization.                              | additive, idempotent with key, open-world                        |
| `get_source_run_status` | Inspect connector synchronization progress and results.                      | read-only, closed-world                                          |

`list_collections` is intentionally added to the original spec catalog. Agents
need a small discovery capability before they can search responsibly.

`reprocess_documents` is preferred over a generic `create_ingestion` tool name.
The agent should see the intent of the operation rather than an internal REST
resource name.

### 8.2 Destructive Operations

Do not expose destructive or administrative tools in the first release:

```txt
delete_document
delete_collection
pause_schedule
resume_schedule
```

Add them only after Canary has a clear confirmation and approval model. The MCP
tool specification recommends human-in-the-loop controls for tool invocations,
especially operations that modify external state.

### 8.3 Search Result Shape

`search_collection` should return bounded evidence objects:

```rust
pub struct SearchOutput {
    pub collection_id: PublicId<CollectionId>,
    pub query: String,
    pub evidence: Vec<Evidence>,
    pub next_cursor: Option<PublicId<ChunkId>>,
}

pub struct Evidence {
    pub chunk_id: PublicId<ChunkId>,
    pub document_id: PublicId<DocumentId>,
    pub title: String,
    pub excerpt: String,
    pub location: Option<String>,
    pub score: f32,
    pub resource: Url,
}
```

The resource link allows an agent to read the focused chunk or canonical
document only when the extra context is useful.

### 8.4 Asynchronous Operations

Mutating tools should return Canary durable-operation identifiers:

```rust
pub struct Accepted {
    pub operation_id: PublicId<OperationId>,
    pub status: OperationState,
    pub resource: Url,
}
```

MCP tasks were introduced in protocol version `2025-11-25` and remain
experimental. Canary should initially expose its own durable operation model
through structured tool output and status resources.

Add an MCP task bridge later, once task polling, cancellation, and result
retrieval can be backed by Canary operations rather than process-local state.

## 9. Resources

Use resources for data that agents may need to inspect after a compact tool
response.

Recommended URI templates:

```txt
canary://collections/{collection_id}
canary://collections/{collection_id}/documents/{document_id}
canary://collections/{collection_id}/chunks/{chunk_id}
canary://collections/{collection_id}/ingestions/{ingestion_id}
canary://collections/{collection_id}/ingestions/{ingestion_id}/events
canary://collections/{collection_id}/sources/{source_id}
canary://collections/{collection_id}/sources/{source_id}/runs/{run_id}
```

Design rules:

- parse URIs into a typed `CanaryUri` enum;
- authorize after parsing and before loading data;
- enforce collection containment for every nested resource;
- list only high-level resources such as collections and recent operations;
- do not enumerate every chunk through `resources/list`;
- return focused chunk links from `search_collection`;
- return canonical document links from `get_document`;
- return operation and event links from mutating tools.

Add resource subscriptions after ingestion and connector-run events have a
stable notification source. Good subscription candidates are:

```txt
canary://collections/{collection_id}/ingestions/{ingestion_id}
canary://collections/{collection_id}/sources/{source_id}/runs/{run_id}
```

## 10. Skills as MCP Prompts

MCP does not define a wire-level primitive named `skill`. MCP prompts are the
right protocol representation for Canary's reusable, user-selectable agent
skills.

Prompts are intentionally user-controlled. They should read like careful
workflow instructions rather than hidden behavioral patches.

Initial prompts:

| Prompt                          | Purpose                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `answer_with_sources`           | Search private knowledge, follow evidence links when needed, cite documents and locations, and state when the corpus does not support an answer. |
| `ingest_and_verify`             | Select text or URL ingestion, start ingestion, inspect its status, and summarize acceptance or failure.                                          |
| `investigate_ingestion_failure` | Read ingestion status and event resources, explain the likely failure, and recommend remediation without retrying automatically.                 |
| `sync_source_and_review`        | Start an explicitly requested connector sync, inspect the resulting run, and summarize changed documents and failures.                           |

Prompt descriptions should make side effects visible. For example,
`sync_source_and_review` must say that it starts external connector work and
should only be selected after explicit user intent.

## 11. Rust Module Shape

Keep the implementation small and aligned with the existing server crate:

```txt
crates/server/src/mcp/
  assets/
    instructions.md
    skills/
      answer-with-sources.md
      ingest-and-verify.md
      investigate-ingestion-failure.md
      sync-source-and-review.md
  mod.rs
  error.rs
  model.rs
  prompts.rs
  resources.rs
  server.rs
  tools.rs
  transport.rs
```

Responsibilities:

| Module         | Responsibility                                                             |
| -------------- | -------------------------------------------------------------------------- |
| `assets/*`     | Embedded server instructions and prompt-backed skill prose                 |
| `error.rs`     | Structured MCP `not_implemented` errors and later domain-error translation |
| `model.rs`     | Semantic state enums and bounded progress values                           |
| `prompts.rs`   | Typed user-selectable prompt-backed skills                                 |
| `resources.rs` | Resource listing, templates, reads, and later subscriptions                |
| `server.rs`    | `Mcp` handler, capabilities, embedded instructions, and SDK routers        |
| `tools.rs`     | Typed curated tool contracts and service-backed handlers                   |
| `transport.rs` | Stateful Streamable HTTP adapter and transport security configuration      |

Typed parsing for `canary://` resource URIs and per-call MCP policy helpers
should become dedicated modules when storage-backed handlers are added.

The route module should remain small:

```rust
#[inline(always)]
pub fn router(state: &AppState, token: CancellationToken) -> Router<AppState> {
    crate::mcp::transport::router(state, token)
}
```

The one-line `router` helper keeps `#[inline(always)]`, matching the server
crate's utility-function convention.

Use `rmcp` macro routers for tools and prompts:

```rust
#[derive(Clone)]
pub struct Mcp {
    _state: AppState,
    tools: ToolRouter<Self>,
    prompts: PromptRouter<Self>,
}

#[tool_router(vis = "pub(crate)")]
impl Mcp {
    #[tool(
        name = "search_collection",
        description = "Search a collection of ingested documents and return grounded evidence with document metadata, source locations, relevance scores, and resource links.",
        annotations(
            title = "Search collection",
            read_only_hint = true,
            open_world_hint = false
        )
    )]
    async fn search(
        &self,
        params: Parameters<SearchInput>,
    ) -> Result<Json<SearchOutput>, ErrorData> {
        Err(error::todo("search_collection"))
    }
}

#[tool_handler(router = self.tools)]
#[prompt_handler(router = self.prompts)]
impl ServerHandler for Mcp {
    fn get_info(&self) -> ServerInfo {
        todo!()
    }
}
```

Each SDK service factory invocation should create a handler for one logical MCP
session while sharing the cloneable application state.

Long editorial text stays in Markdown assets and is compiled into the binary
with `include_str!`. Rust source remains focused on the protocol structure,
typed contracts, and service dispatch.

## 12. Errors

MCP handlers should not translate domain failures through HTTP problem
responses. Add one MCP-specific error boundary:

```txt
domain error -> MCP ErrorData
```

Error behavior:

- use stable Canary error codes in MCP error data;
- include enough structured context for an agent to recover;
- distinguish invalid input, missing resources, forbidden access, conflicts,
  rate limits, and internal failures;
- preserve the request ID for audit correlation;
- avoid leaking internal causes or secrets;
- keep HTTP RFC-compliant errors for HTTP transport failures outside JSON-RPC.

## 13. Progressive Disclosure

Keep the initial tool catalog small and static. Perform per-call authorization
inside every tool and resource handler.

When Canary has materially different deployment profiles or principal roles,
add a thin catalog policy layer:

- hide tools unavailable in the current deployment;
- hide administrative tools unless an approval-capable profile enables them;
- emit `notifications/tools/list_changed` only when a session's visible
  catalog genuinely changes.

This borrows the best progressive-disclosure idea from `turbomcp` without
adding another MCP framework dependency.

## 14. Implementation Phases

### Phase 1: Foundation

- add `rmcp`;
- replace the TODO MCP route with `StreamableHttpService`;
- support `POST`, `GET`, and `DELETE` at `/mcp`;
- split REST and MCP middleware behavior;
- bridge MCP cancellation to server shutdown;
- implement principal extraction and MCP error translation;
- configure explicit host and origin policies.

### Phase 2: Read-Only Knowledge

- add `list_collections`;
- add `search_collection`;
- add `list_documents`;
- add `get_document`;
- add collection, document, and chunk resources;
- return typed structured outputs with resource links.

### Phase 3: Ingestion

- add `ingest_text`;
- add `ingest_url`;
- add `reprocess_documents`;
- add `get_ingestion_status`;
- add ingestion status and event resources;
- enforce idempotency keys and audit logs.

### Phase 4: Connectors

- add `list_sources`;
- add `run_source_sync`;
- add `get_source_run_status`;
- add source and source-run resources;
- enforce SSRF-safe connector boundaries and external-system auditing.

### Phase 5: Skills and Live Updates

- add prompt-backed skills;
- add resource subscriptions for ingestion and source-run state;
- add resumability storage for multi-instance deployments;
- consider an MCP task bridge backed by Canary durable operations;
- add approval-aware administrative tools only when the product has an
  explicit confirmation model.

## 15. Primary Sources

- [`rmcp` crate documentation](https://docs.rs/crate/rmcp/latest)
- [`rmcp` official Rust SDK repository](https://github.com/modelcontextprotocol/rust-sdk)
- [`StreamableHttpService`](https://docs.rs/rmcp/latest/rmcp/transport/streamable_http_server/tower/struct.StreamableHttpService.html)
- [`StreamableHttpServerConfig`](https://docs.rs/rmcp/latest/rmcp/transport/streamable_http_server/tower/struct.StreamableHttpServerConfig.html)
- [`rmcp::Json<T>` structured output](https://docs.rs/rmcp/latest/rmcp/handler/server/wrapper/struct.Json.html)
- [`rmcp` tool-router macro](https://docs.rs/rmcp/latest/rmcp/attr.tool_router.html)
- [`rmcp` prompt-router macro](https://docs.rs/rmcp/latest/rmcp/attr.prompt_router.html)
- [MCP specification `2025-11-25`](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [MCP tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [`rust-mcp-sdk`](https://github.com/rust-mcp-stack/rust-mcp-sdk)
- [`turbomcp`](https://github.com/Epistates/turbomcp)
- [`prism-mcp-rs`](https://github.com/prismworks-ai/prism-mcp-rs)

## 16. Experimental MCP Tasks

MCP task support would give compatible agents a standard asynchronous workflow
for long-running tool calls:

```txt
tools/call
  -> task handle immediately
tasks/get
  -> progress and status
tasks/cancel
  -> cooperative cancellation
tasks/result
  -> final tool result
```

This is a natural fit for ingestion, document reprocessing, and connector
synchronization.

### What We Gain

- better interoperability with MCP clients that understand asynchronous work;
- protocol-native polling intervals and result-retention TTLs;
- protocol-level cancellation;
- progress reporting without Canary-specific orchestration instructions;
- a clean mapping from MCP task IDs to durable Canary `OperationId` values;
- a path to multi-step workflows with `input_required`, such as approvals or
  missing connector credentials.

### Production Requirements

Tasks do not provide durable execution by themselves. Canary would still need:

- a real operation service;
- persistent operation state;
- authorization binding between the principal, operation, and MCP session;
- retention cleanup for completed task results;
- audit events for creation, progress, completion, cancellation, and failure;
- cooperative cancellation in workers and external connector boundaries.

The process-local SDK task manager is not sufficient for production. Canary
should first implement durable operations as the source of truth, then add a
thin MCP task adapter behind capability negotiation.

The `2025-11-25` task API remains experimental. Before implementing the
adapter, confirm the current MCP extension wire format and the matching `rmcp`
support so Canary does not commit to a superseded protocol shape.
