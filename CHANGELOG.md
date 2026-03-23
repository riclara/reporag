# Changelog

## [0.5.1](https://github.com/riclara/reporag/compare/reporag-v0.5.0...reporag-v0.5.1) (2026-03-23)


### Bug Fixes

* **init:** preserve existing Codex config ([#14](https://github.com/riclara/reporag/issues/14)) ([3a098f5](https://github.com/riclara/reporag/commit/3a098f5d5612f3b2370055588b3490ac6330c146))

## [0.5.0](https://github.com/riclara/reporag/compare/reporag-v0.4.0...reporag-v0.5.0) (2026-03-13)


### Features

* add adapters and indexing domain ([84722f7](https://github.com/riclara/reporag/commit/84722f70d5a4d1467e9859466f6bc55c474ce7cb))
* **cli:** add version flag ([#6](https://github.com/riclara/reporag/issues/6)) ([9e80b58](https://github.com/riclara/reporag/commit/9e80b5869f340cf13ac3c44398f896de8c7fc6d4))
* **cli:** notify about newer npm releases ([#8](https://github.com/riclara/reporag/issues/8)) ([0325574](https://github.com/riclara/reporag/commit/0325574f47bbe5d5edec06893ebb6643a2795929))
* expose app services, CLI and MCP server ([33929e6](https://github.com/riclara/reporag/commit/33929e682920edefa034aaf9954e2c4788f5e4f1))


### Bug Fixes

* make release-please secret check workflow-safe ([#2](https://github.com/riclara/reporag/issues/2)) ([6e6e00b](https://github.com/riclara/reporag/commit/6e6e00b24d4b39b6d431ae59a9b5c99ee43f1a90))

## [0.4.0](https://github.com/riclara/reporag/compare/reporag-v0.3.0...reporag-v0.4.0) (2026-03-13)


### Features

* **cli:** notify about newer npm releases ([#8](https://github.com/riclara/reporag/issues/8)) ([0325574](https://github.com/riclara/reporag/commit/0325574f47bbe5d5edec06893ebb6643a2795929))

## [0.3.0](https://github.com/riclara/reporag/compare/reporag-v0.2.0...reporag-v0.3.0) (2026-03-13)


### Features

* **cli:** add version flag ([#6](https://github.com/riclara/reporag/issues/6)) ([9e80b58](https://github.com/riclara/reporag/commit/9e80b5869f340cf13ac3c44398f896de8c7fc6d4))

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
