<div align="center">
  <img src="/.github/images/github-header-image.webp" alt="GitHub Header Image" width="auto" />
  <p></p>
  <p></p>
  <!-- MIT License -->
  <a href="https://github.com/hadronomy/canary/blob/main/LICENSE">
    <img
      alt="Content License"
      src="https://img.shields.io/github/license/hadronomy/canary?style=for-the-badge&logo=starship&color=ee999f&logoColor=D9E0EE&labelColor=302D41"
    />
  </a>

  <!-- GitHub Repo Stars -->
  <a href="https://github.com/hadronomy/canary/stargazers">
    <img
      alt="Stars"
      src="https://img.shields.io/github/stars/hadronomy/canary?style=for-the-badge&logo=starship&color=c69ff5&logoColor=D9E0EE&labelColor=302D41"
    />
  </a>
  <p></p>
  <p align="center">
    <em>With great <strong>retrieval</strong> comes great <strong>legislation</strong></em><br>
    <sub>— Uncle Ben (probably)</sub>
  </p>
  <p></p>
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#license">License</a>
  <hr />

</div>

This project is a WIP, agentic legal assistance system. It can aid legislators, lawyers and common people on retrieving and consulting the law.

The agent will use all of its tools that interface with the database index, to fetch with multiple hops and reasoning the relevant laws for any query.

It features a parser that extracts complete legal documents (BOE - Boletín Oficial del Estado) into a complete node/path system, where from each fragment of the node you can navigate the documents, find the articles you need and the context you need, giving superpowers to the agent.

## Architecture

### Data Model

Legal documents are stored in a hierarchical structure using PostgreSQL with pgvector:

- **legal_documents**: Main document storage with 256-dim summary embeddings
- **sense_fragments**: Document fragments with dual embeddings (256-dim for ANN search, 1024-dim for reranking)
- **reference_anchors**: Cross-references between documents (deroga, modifica, interpreta, etc.)
- **document_versions**: Version control for temporal validity tracking
- **fragment_index_jobs**: Queue for embedding generation

The system uses PostgreSQL's `ltree` extension for hierarchical path queries, enabling efficient navigation from any fragment to its parents, children, and siblings.

### Two-Stage Retrieval System

1. **Fast Candidate Generation**: Uses 256-dim embeddings with HNSW index for approximate nearest neighbor search
2. **Precise Reranking**: Uses 1024-dim embeddings for accurate relevance scoring
3. **Context Expansion**: Uses ltree paths to navigate the document hierarchy and gather surrounding context
4. **Multi-hop Navigation**: Follows reference anchors to related documents (modifications, repeals, citations)

### Parser System

The BOE parser converts XML documents into a navigable AST with:

- Hierarchical node structure (libro → título → capítulo → sección → artículo → párrafo)
- Dual path representation: structural paths and legal citation paths
- Fragment extraction for semantic search indexing
- Reference extraction for cross-document linking

## Tech Stack

- **Effect** - Type-safe, composable async effects and service layer
- **TypeScript** - Type safety throughout the entire stack
- **Bun** - Fast JavaScript runtime
- **PostgreSQL + pgvector** - Vector database with HNSW indexing
- **Drizzle ORM** - TypeScript-first database schema
- **TanStack Router** - File-based routing (web)
- **TailwindCSS** - Utility-first CSS (web)
- **shadcn/ui** - Reusable UI components (web)
- **Turborepo** - Optimized monorepo build system
- **Oxlint** - Linting and formatting

## Project Structure

```
canary/
├── apps/
│   ├── web/              # Frontend application (React + TanStack Router)
│   ├── server/           # Backend services (Effect-based collector/indexer)
│   ├── tui/              # Terminal UI application
│   └── fumadocs/         # Documentation site
├── packages/
│   ├── db/               # Database schema and Effect service
│   ├── env/              # Environment configuration
│   └── config/           # Shared configuration
└── docs/                 # Design docs and RFCs
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- PostgreSQL 16+ with pgvector extension
- Jina AI API key (for embeddings)

### Installation

```bash
bun install
```

### Database Setup

1. Create a PostgreSQL database with pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS ltree;
```

2. Configure environment:

```bash
cp apps/server/.env.example apps/server/.env
# Edit with your DATABASE_URL and JINA_API_KEY
```

3. Push schema to database:

```bash
bun run db:push
```

### Running the Collector

The collector fetches and indexes BOE documents:

```bash
bun run dev:server
```

This starts the Effect-based collector service that:

- Fetches XML documents from BOE
- Parses into hierarchical fragments
- Generates embeddings via Jina AI
- Stores in PostgreSQL with vector indexing

### Running the Web App

```bash
bun run dev:web
```

Open [http://localhost:3001](http://localhost:3001) to access the web interface.

## Development Commands

- `bun run dev` - Start all applications in development mode
- `bun run dev:web` - Start only the web application
- `bun run dev:server` - Start the collector/indexer service
- `bun run build` - Build all applications
- `bun run check-types` - Type-check all packages
- `bun run db:push` - Push schema changes to database
- `bun run db:studio` - Open Drizzle Studio
- `bun run check` - Run Oxlint and Oxfmt
- `bun run retrieval:audit` - Benchmark retrieval performance

## Git Hooks

Initialize hooks:

```bash
bun run prepare
```

Format and lint:

```bash
bun run check
```

## License

MIT
