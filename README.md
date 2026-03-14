English | [Espanol](README.es.md)

# reporag

`reporag` is a local repository intelligence CLI with a built-in MCP server.

The package exposes two equivalent commands:

- `reporag`
- `rr`

Its goal is to turn a code repository into a locally queryable knowledge base for:

- people working from the terminal
- agents through MCP
- local workflows without depending on an external database

Instead of treating the repository as plain text, `reporag` indexes symbols, call
relations, and code chunks so it can answer useful questions such as:

- where a symbol lives
- who calls a function
- what a function calls
- which files or symbols are relevant to a text query

Documentation:

- [English docs](docs/README.md)
- [Documentacion en espanol](docs/README.es.md)
- [Blog post in English](https://ricardolara.dev/blog/why-i-built-reporag/)
- [Blog post in Spanish](https://ricardolara.dev/es/blog/por-que-construi-reporag/)

## Why it exists

Many code RAG workflows fail for three reasons:

- they depend on heavy infrastructure for a local problem
- they mix text search with weak structural heuristics
- they do not provide a clear interface for agents such as Codex, Claude, or Gemini
  to query the repository consistently

`reporag` exists to address those three problems with a local-first architecture:

- a SQLite index inside the repository
- `FTS5` search for low-latency local retrieval
- structural relations for `symbol`, `callers`, and `callees`
- MCP on top of the same CLI core

## Value proposition

The real value of `reporag` is not "having embeddings" or "having MCP". The
value is this:

- you can initialize and index a repository without external services
- you can query real code structure, not only approximate text matches
- you can expose that knowledge to AI assistants with the same semantics you use
  in the CLI
- you can work offline, or almost offline, for most of the workflow
- you can measure the system locally before publishing it or wiring it to agents

In practice, it is useful for:

- navigating medium-size repositories without opening the whole tree manually
- giving structured context to agents
- debugging workflows where an AI needs to understand real symbols and calls
- accelerating onboarding in TypeScript and JavaScript codebases

## Technologies and why they are used

### TypeScript

`reporag` is implemented in TypeScript because the project domain is precisely
understanding TypeScript and JavaScript repositories, and the TypeScript
compiler gives direct access to the AST and semantic resolution.

Value:

- strong parser for symbols and relations
- `ts.Program` to resolve aliases, defaults, and reexports
- less friction when evolving toward deeper semantic resolution

### SQLite

SQLite is used as the local index store.

Value:

- no service needs to be started
- it lives inside the repository at `.reporag/index.sqlite`
- it supports a relational model for `files`, `symbols`, `relations`, and
  `chunks`
- it simplifies local inspection and debugging

### SQLite FTS5

`FTS5` is used for textual retrieval.

Value:

- very low local latency
- better lexical ranking than scanning in memory
- a solid base for combining text and structure

### TypeScript Compiler API

It is used to extract symbols and structural relations.

Value:

- identifies functions, classes, methods, and variables
- resolves calls beyond string-literal matching
- improves `callers` and `callees` with real code information

### MCP

`reporag` exposes an MCP server over `stdio`.

Value:

- Codex, Claude, and Gemini can query the same index
- there is no divergence between what the CLI returns and what the agent returns
- the local integration becomes simple and reproducible

### Optional embeddings

Embeddings exist as an optional reranking layer.

Value:

- they improve ranking when a query needs more semantics than exact text
- they are not required for the system to work
- they allow a useful local MVP without making setup fragile

## Architecture

`reporag` has a shared core and two surfaces:

```text
CLI -> core -> SQLite / parser / retrieval
MCP -> core -> SQLite / parser / retrieval
```

That avoids having two different engines and reduces bugs caused by inconsistent
behavior.

Main components:

- `init`: prepares config, SQLite, a local MCP entry named `reporag`, and local
  guidance for agents and Claude Code
- `index`: scans files and extracts symbols, relations, chunks, and optional
  embeddings
- `query`: combines `FTS5` and structural reranking, with optional embeddings
- `symbol`: exact or approximate symbol lookup
- `callers`: finds who calls a symbol
- `callees`: finds what a symbol calls
- `doctor`: checks index and configuration health
- `mcp serve`: exposes MCP tools on top of the same engine

## Installation

### Published package

```bash
npm install -g reporag
```

### From the workspace

```bash
cd /Users/riclara/workspace/reporag
npm install
npm run bundle:cli
node packages/cli/bundle/reporag.cjs status
```

### Try it before publishing with `npm link`

```bash
cd /Users/riclara/workspace/reporag
npm run bundle:cli

cd /Users/riclara/workspace/reporag/packages/cli
npm link
```

Then, in any repository:

```bash
reporag init
reporag index
reporag query "something"
```

Or using the short alias:

```bash
rr init
rr index
rr query "something"
```

## Quick usage

```bash
reporag init
reporag query "repository status"
reporag symbol runMcpServer
reporag callers helper
reporag callees runMcpServer
reporag status
reporag doctor
reporag mcp serve
```

Short alias:

```bash
rr init
rr index
rr query "repository status"
rr symbol runMcpServer
rr callers helper
rr callees runMcpServer
rr status
rr doctor
rr mcp serve
```

## What `init` generates

`reporag init` creates:

- `.reporag/config.json`
- `.reporag/index.sqlite`
- `.reporag/run-mcp-server.cjs`
- `.codex/config.toml`
- `.codex/skills/reporag-mcp-usage/SKILL.md`
- `.mcp.json`
- `.claude/reporag-mcp.md`
- `.claude/settings.local.json`
- `.claude/settings.json`
- `.gemini/settings.json`
- `AGENTS.md` created or updated with a managed block for `reporag`
- `CLAUDE.md` created or updated with a managed block that imports
  `@.claude/reporag-mcp.md`

It also adds the generated local artifacts to `.gitignore`:

- `.reporag/`
- `.codex/config.toml`
- `.codex/skills/reporag-mcp-usage/`
- `.mcp.json`
- `.claude/settings.local.json`
- `.claude/settings.json`
- `.gemini/settings.json`

`AGENTS.md` is not ignored by default. `reporag init` only manages its marked
block and preserves any extra repository content.

`CLAUDE.md` and `.claude/reporag-mcp.md` are not ignored by default either.
`reporag init` only manages its marked block inside `CLAUDE.md`, and the modular
`.claude/reporag-mcp.md` file remains versionable as Claude-native guidance.

`init` also runs a first `index`, so the repository is ready to query
immediately.

The idea is to leave the repository ready for the CLI, MCP clients, generic
agents, and Claude Code whenever they need instructions on when to use
`reporag`.

## Available MCP tools

Today `reporag mcp serve` exposes:

- `search_code`
- `get_symbol`
- `find_callers`
- `find_callees`

## Current status

`reporag` already supports:

- `init`
- `index`
- `query`
- `symbol`
- `callers`
- `callees`
- `status`
- `doctor`
- `mcp serve`
- `FTS5`
- optional embeddings for reranking
- improved TypeScript semantic resolution for aliases, defaults, and reexports

## Current limitations

- the current focus is TypeScript and JavaScript
- there is no native vector index in SQLite; embeddings currently rerank FTS
  candidates
- `calls` relations are much better than at the beginning, but they still do not
  cover every complex case in the TypeScript ecosystem
- measured quality is good in this repository and in controlled fixtures, but it
  still needs broader multi-repository validation

## Optional embeddings

You can enable embeddings in `.reporag/config.json`:

```json
{
  "embeddings": {
    "enabled": true,
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

Notes:

- `enabled: false` by default
- `provider: "openai"` requires `OPENAI_API_KEY`
- `provider: "mock"` is useful for local tests

## Current measurement

The project already includes a reproducible benchmark:

```bash
npm run benchmark
```

Latest local validation:

- structural fixture: `5/5`
- `reporag` self suite: `5/5`
- warm self latency: around `p50 1-2 ms`

Full report at [.reporag/benchmark-report.json](.reporag/benchmark-report.json).

## Release

To validate a local release:

```bash
npm run release:validate
```

Detailed checklist in [docs/release-checklist.md](docs/release-checklist.md).
