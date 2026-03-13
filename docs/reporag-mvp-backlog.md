English | [Espanol](reporag-mvp-backlog.es.md)

# Executable `reporag` Backlog

## Implementation status (auto-updated)

Last update: 2026-03-10

### Completed milestones

- **Monorepo + build**: `packages/*` workspaces, TypeScript project references,
  and `npm run build` compiles.
- **Shared core**: `CodeIntelService` from the `app` package is used by the CLI.
- **Local bootstrap (`reporag init`)**:
  - creates `.reporag/`
  - generates `.reporag/config.json`
  - creates `.reporag/index.sqlite`
  - creates the `index_metadata` table and sets `schema_version = 1`

### Immediate work in progress

- **`reporag index` (cut 1)**: TS/JS file scan plus persistence in `files`
  (`hash` and `updated_at`).

### Implemented (cut 1)

- **`reporag index` (minimum)**:
  - reads `include` and `exclude` from `.reporag/config.json`
  - scans files (TS/JS) and computes `sha1`
  - ensures the minimum SQLite schema exists, creating `files` if needed
  - upserts `files(path, language, sha1, updated_at)`

### Implemented (scanner + symbols, cut 2)

- **SQLite schema**:
  - extra tables `symbols(file_id, parent_symbol_id, name, kind, signature,
    start_line, end_line, exported)` and
    `relations(source_symbol_id, target_symbol_id, relation_type)` are created
    in `ensureDatabase`.
- **TS/JS parser**:
  - `adapters/parser/typescript` provides basic extraction for:
    - functions
    - classes
    - class methods
    - exported and non-exported variables
- **Symbol index**:
  - `reporag index` now:
    - walks the scanned files
    - parses code with the TypeScript Compiler API
    - stores minimal symbols in `symbols` with one level and no relations yet
    - prints the total indexed symbol count in the CLI (`symbols: N`)

## 1. Decision

Yes, `reporag` is worth building, but not as a full reimplementation of
`ai-ragcode`.

The starting thesis for `reporag` is:

- primary product: local repository intelligence CLI
- derived product: MCP server reusing exactly the same core
- base persistence: local SQLite
- initial support: TypeScript and JavaScript
- initial retrieval: symbols, relations, and FTS
- true hybrid retrieval: second MVP wave, not day 1

## 2. Name and initial surface

Binary name:

```bash
reporag
```

MVP commands:

```bash
reporag init
reporag index
reporag query "<text>"
reporag symbol <name>
reporag callers <symbol>
reporag status
reporag doctor
reporag mcp serve
```

Commands outside the first sprint:

- `reporag callees`
- `reporag explain-flow`
- `reporag watch`
- automatic Git hooks
- multi-language support beyond TS/JS
- advanced ranking with deeper graph expansion

## 3. MVP goal

At the end of the initial buildout, `reporag` must be able to:

1. initialize `.reporag/` inside a repository
2. index TS/JS files with symbols and basic relations
3. answer useful text, symbol, and callers queries
4. expose those same capabilities through MCP
5. operate locally with SQLite, without requiring Postgres

## 4. Non-goals for the MVP

These items should not be part of the first execution backlog:

- complex working-tree overlay
- session memory
- model routing
- sophisticated multi-repository benchmarking
- perfect incremental indexing from the first cut
- support for Python, Java, Dart, or other languages
- highly domain-specific contextual heuristics

## 5. Bootstrap architecture

Key principle: the CLI and the MCP server must not contain domain logic.

Proposed structure:

```txt
packages/
  domain/
    src/
      bootstrap.ts
      status.ts
      query.ts
      index/
        planner.ts
        runner.ts
      symbols/
        lookup.ts
        callers.ts
  adapters/
    src/
      storage/
        sqlite.ts
        migrations/
      parser/
        typescript.ts
      retrieval/
        fts.ts
        vector.ts
      embeddings/
        openai.ts
  app/
    src/
      codeintel-service.ts
  cli/
    src/
      commands/
        init.ts
        index.ts
        query.ts
        symbol.ts
        callers.ts
        status.ts
        doctor.ts
        mcp-serve.ts
  mcp-server/
    src/
      server.ts
      tools/
        search-code.ts
        get-symbol.ts
        find-callers.ts
  shared/
    src/
      schemas/
      types/
      utils/
```

## 6. Base contracts

### 6.1 Central tool

Name:

```txt
resolve-repository-query
```

Minimum input:

```ts
type QueryIntent = "hybrid-search" | "symbol-lookup" | "find-callers";

type QueryInput = {
  repoRoot: string;
  intent: QueryIntent;
  query?: string;
  symbolName?: string;
  limit?: number;
  stalePolicy?: "fail" | "warn" | "auto-index-light";
};
```

Minimum output:

```ts
type QueryHit = {
  filePath: string;
  symbolName?: string;
  startLine: number;
  endLine: number;
  score: number;
  rationale: string;
};

type QueryResult =
  | {
      ok: true;
      route: "symbol" | "fts" | "hybrid";
      stale: boolean;
      hits: QueryHit[];
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "REPO_NOT_INITIALIZED"
        | "INDEX_STALE"
        | "UNSUPPORTED_LANGUAGE"
        | "EMBEDDINGS_UNAVAILABLE";
      message: string;
      retryable: boolean;
    };
```

### 6.2 Boundary validation

Every CLI or MCP input must be validated with Zod before touching storage or
parser layers.

### 6.3 Operating rule

If embeddings are unavailable, `reporag query` must continue working with
`FTS + symbol boost`. The product must not be blocked by the vector layer.

## 7. Minimum data model

Local database:

```txt
.reporag/index.sqlite
```

Tables for the initial cut:

- `files`
- `symbols`
- `relations`
- `chunks`
- `index_metadata`

`chunk_embeddings` and a vector index can stay in the second MVP block.

Recommended minimum fields:

```txt
files(id, path, language, sha1, updated_at)
symbols(id, file_id, parent_symbol_id, name, kind, signature, start_line, end_line, exported)
relations(id, source_symbol_id, target_symbol_id, relation_type)
chunks(id, file_id, symbol_id, chunk_type, content, start_line, end_line, content_sha1)
index_metadata(key, value)
```

## 8. Two-week roadmap

## Week 1

### Block 1. Scaffold and contracts

Goal:
leave the repository ready to grow without mixing transport and domain logic.

Tasks:

- create the basic monorepo with `packages/`
- configure TypeScript, lint, and test
- define shared Zod schemas
- define `InitInput`, `QueryInput`, `QueryResult`, and `RepoStatus` types
- create `CodeIntelService` as the application facade

Acceptance criteria:

- `npm run build` compiles
- `npm test` can run at least one smoke test
- CLI and MCP can import the same service without duplication

### Block 2. Local bootstrap

Goal:
have a working `reporag init` with local SQLite.

Tasks:

- detect repository root
- create `.reporag/`
- create `config.json`
- create `index.sqlite`
- run migrations
- record initial metadata
- add `.reporag/` to `.gitignore` when applicable

Acceptance criteria:

- `reporag init` leaves the repository ready without asking for Postgres
- running `init` twice does not break anything
- the command fails with clear messages when outside a valid repository

### Block 3. TS/JS scanner and parser

Goal:
produce a useful minimum structural index.

Tasks:

- scan files according to include and exclude
- parse TS/JS
- extract main symbols
- extract imports and basic calls
- persist `files`, `symbols`, and `relations`

Acceptance criteria:

- a small TS/JS repository generates navigable symbols
- at least functions, classes, and methods can be found
- parse failures are reported without aborting the full indexing run

## Week 2

### Block 4. Chunks, FTS, and `query`

Goal:
deliver real value without depending on embeddings yet.

Tasks:

- build chunks by symbol
- create an FTS index over chunk content
- implement the base ranking
- implement `reporag query`
- return file, symbol, lines, score, and a short rationale

Acceptance criteria:

- `reporag query` answers simple questions about a TS/JS repository
- `query` works without embeddings
- warm latency is acceptable on medium-size repositories

### Block 5. `symbol`, `callers`, `status`, `doctor`

Goal:
provide direct structural tools beyond search.

Tasks:

- implement `reporag symbol <name>`
- implement `reporag callers <symbol>`
- implement `reporag status`
- implement `reporag doctor`
- detect missing or stale indexes

Acceptance criteria:

- `symbol` finds exact or approximate matches
- `callers` returns traceable relations
- `doctor` validates SQLite, schema, config, and index state

### Block 6. Minimal MCP sharing the core

Goal:
expose the same engine to agents without duplicating logic.

Tasks:

- launch `reporag mcp serve` over `stdio`
- expose `search_code`, `get_symbol`, and `find_callers` tools
- map tools to the same `CodeIntelService`
- normalize errors and outputs

Acceptance criteria:

- the MCP server uses the same contract as the CLI
- there is no SQL or domain parsing inside `mcp-server`
- an MCP client can query an already indexed repository

## 9. Immediate follow-up backlog

These items only enter once the two-week cut is stable:

1. OpenAI embeddings
2. `sqlite-vec` or another validated vector alternative
3. hybrid ranking with `FTS + vector + symbol boost`
4. incremental hash-based indexing
5. `find_callees`
6. lightweight stale detection at query time
7. optional thin Git hooks

## 10. Startup success criteria

`reporag` is considered validated to continue if it meets this minimum bar:

- `init` works without complex external dependencies
- `index` processes a medium-size TS/JS repository in less than 5 minutes on a
  cold start
- `query` answers on the warm path with `p50 < 1.5s`
- `symbol` and `callers` are correct in most cases in the test set
- MCP returns the same kind of results as the CLI

## 11. Risks that must not be reintroduced

- turning the MVP into another oversized platform
- making the vector layer mandatory before proving real utility
- duplicating logic between CLI and MCP
- promising multi-language support without per-language contracts
- adding aggressive auto-indexing inside `query`
- mixing global config, credentials, and business logic inside `init`

## 12. Real implementation order

Recommended sequence:

1. technical scaffold
2. schemas and contracts
3. SQLite and migrations
4. `reporag init`
5. file scanner
6. TS/JS parser
7. symbols and relations
8. chunks
9. FTS
10. `reporag query`
11. `reporag symbol`
12. `reporag callers`
13. `reporag status`
14. `reporag doctor`
15. `reporag mcp serve`
16. embeddings
17. true hybrid retrieval
18. incremental indexing

## 13. Definition of done for the first internal release

The first internal `reporag` release is ready when:

- there is an installable and buildable repository
- the `init -> index -> query -> symbol -> callers -> mcp serve` flow works
- there are minimum smoke tests and tests against a fixture repository
- there is documentation for installation, support limits, and basic
  troubleshooting
- the team can use it in at least one real repository without depending on
  tribal knowledge
