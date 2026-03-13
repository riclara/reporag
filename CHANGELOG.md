# Changelog

## [0.2.0](https://github.com/riclara/reporag/compare/reporag-v0.1.0...reporag-v0.2.0) (2026-03-13)


### Features

* add adapters and indexing domain ([84722f7](https://github.com/riclara/reporag/commit/84722f70d5a4d1467e9859466f6bc55c474ce7cb))
* expose app services, CLI and MCP server ([33929e6](https://github.com/riclara/reporag/commit/33929e682920edefa034aaf9954e2c4788f5e4f1))


### Bug Fixes

* make release-please secret check workflow-safe ([#2](https://github.com/riclara/reporag/issues/2)) ([6e6e00b](https://github.com/riclara/reporag/commit/6e6e00b24d4b39b6d431ae59a9b5c99ee43f1a90))

## 0.1.0 - 2026-03-10

- released initial usable `reporag` CLI and MCP server
- added local-first repository init, indexing and doctor flows
- added `query`, `symbol`, `callers`, `callees` and `status`
- added SQLite `FTS5` retrieval and optional embedding reranking
- added MCP auto-configuration for Codex, Claude and Gemini
- added semantic TypeScript relation resolution with aliases, defaults and reexports
