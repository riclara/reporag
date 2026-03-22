# reporag

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/riclara/reporag)

Local repository intelligence CLI with MCP support.

## Install

```bash
npm install -g reporag
```

## Commands

```bash
reporag init
reporag index
reporag query "repository status"
reporag symbol runMcpServer
reporag callers helper
reporag callees runMcpServer
reporag status
reporag doctor
reporag mcp serve
```

## Notes

- `init` creates local MCP config for Codex, Claude and Gemini, plus a local `reporag-mcp-usage` skill, an `AGENTS.md` managed block, and Claude-native guidance through `CLAUDE.md` + `.claude/reporag-mcp.md`
- retrieval uses SQLite `FTS5`
- embeddings are optional and disabled by default
