#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
CACHE_DIR="${NPM_CONFIG_CACHE:-/tmp/reporag-npm-cache}"
SMOKE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/reporag-pack-smoke.XXXXXX")
TOOLING_DIR="$SMOKE_ROOT/tooling"
FIXTURE_DIR="$SMOKE_ROOT/repo"

printf '[smoke] workspace: %s\n' "$REPO_ROOT"
printf '[smoke] temp root: %s\n' "$SMOKE_ROOT"

mkdir -p "$TOOLING_DIR" "$FIXTURE_DIR"

PACKAGE_TGZ=$(cd "$SMOKE_ROOT" && NPM_CONFIG_CACHE="$CACHE_DIR" npm pack "$REPO_ROOT/packages/cli" --silent)
PACKAGE_PATH="$SMOKE_ROOT/$PACKAGE_TGZ"

printf '[smoke] packed tarball: %s\n' "$PACKAGE_PATH"

cd "$TOOLING_DIR"
npm init -y >/dev/null 2>&1
NPM_CONFIG_CACHE="$CACHE_DIR" npm install "$PACKAGE_PATH" >/dev/null

CLI_BIN="$TOOLING_DIR/node_modules/.bin/reporag"

cd "$FIXTURE_DIR"
printf '{"name":"reporag-smoke","private":true}\n' > package.json
mkdir -p src
printf 'export function hello() { return 1; }\n' > src/index.ts

"$CLI_BIN" status
"$CLI_BIN" init

if [[ ! -f "$FIXTURE_DIR/AGENTS.md" ]]; then
  echo "[smoke] missing AGENTS.md after init" >&2
  exit 1
fi

if [[ ! -f "$FIXTURE_DIR/.codex/skills/reporag-mcp-usage/SKILL.md" ]]; then
  echo "[smoke] missing reporag skill after init" >&2
  exit 1
fi

if [[ ! -f "$FIXTURE_DIR/CLAUDE.md" ]]; then
  echo "[smoke] missing CLAUDE.md after init" >&2
  exit 1
fi

if [[ ! -f "$FIXTURE_DIR/.claude/reporag-mcp.md" ]]; then
  echo "[smoke] missing Claude guidance file after init" >&2
  exit 1
fi

if ! grep -q "reporag-mcp-usage" "$FIXTURE_DIR/AGENTS.md"; then
  echo "[smoke] AGENTS.md does not mention reporag-mcp-usage" >&2
  exit 1
fi

if ! grep -q "@.claude/reporag-mcp.md" "$FIXTURE_DIR/CLAUDE.md"; then
  echo "[smoke] CLAUDE.md does not import the reporag Claude guidance" >&2
  exit 1
fi

if ! grep -q "find_callers" "$FIXTURE_DIR/.codex/skills/reporag-mcp-usage/SKILL.md"; then
  echo "[smoke] generated skill does not contain expected MCP guidance" >&2
  exit 1
fi

if ! grep -q "find_callers" "$FIXTURE_DIR/.claude/reporag-mcp.md"; then
  echo "[smoke] generated Claude guidance does not contain expected MCP guidance" >&2
  exit 1
fi

if ! grep -q ".codex/skills/reporag-mcp-usage/" "$FIXTURE_DIR/.gitignore"; then
  echo "[smoke] .gitignore is missing the reporag skill entry" >&2
  exit 1
fi

"$CLI_BIN" index
"$CLI_BIN" query "hello"
"$CLI_BIN" symbol hello

MCP_STDOUT="$SMOKE_ROOT/mcp.stdout"
MCP_STDERR="$SMOKE_ROOT/mcp.stderr"
"$CLI_BIN" mcp serve >"$MCP_STDOUT" 2>"$MCP_STDERR" &
MCP_PID=$!
sleep 2

kill "$MCP_PID" 2>/dev/null || true
wait "$MCP_PID" || true

if ! grep -q "Repository intelligence MCP server running on stdio" "$MCP_STDERR"; then
  cat "$MCP_STDERR" >&2
  exit 1
fi

printf '[smoke] passed: %s\n' "$SMOKE_ROOT"
