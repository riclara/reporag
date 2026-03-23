import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-config-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  return root;
}

const CLI_ENTRY = path.join(process.cwd(), "packages", "cli", "dist", "cli.js");
const AGENTS_FILENAME = "AGENTS.md";
const CLAUDE_FILENAME = "CLAUDE.md";
const MANAGED_BLOCK_START =
  "<!-- BEGIN reporag managed repository_rag guidance -->";
const CLAUDE_BLOCK_START =
  "<!-- BEGIN reporag managed Claude repository_rag guidance -->";
const SKILL_SEGMENTS = [".codex", "skills", "reporag-mcp-usage", "SKILL.md"];
const CLAUDE_GUIDANCE_SEGMENTS = [".claude", "reporag-mcp.md"];
const { upsertCodexMcpConfig } = require(path.join(
  process.cwd(),
  "packages",
  "shared",
  "dist",
)) as {
  upsertCodexMcpConfig: (
    current: string,
    config: {
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    },
  ) => string;
};

function readRepoFile(root: string, ...segments: string[]): string {
  return fs.readFileSync(path.join(root, ...segments), "utf8");
}

describe("initRepository MCP client config", () => {
  let tempRepo: string;
  const { initRepository } = require(path.join(
    process.cwd(),
    "packages",
    "domain",
    "dist",
  )) as {
    initRepository: (root: string, cliEntryPath?: string) => {
      ok: boolean;
      repoRoot: string;
      alreadyInitialized?: boolean;
    };
  };

  beforeEach(() => {
    tempRepo = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("writes MCP configs and local guidance for Codex, generic agents and Claude", () => {
    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const codexConfig = readRepoFile(result.repoRoot, ".codex", "config.toml");
    const claudeMcp = JSON.parse(readRepoFile(result.repoRoot, ".mcp.json")) as Record<
      string,
      unknown
    >;
    const claudeSettings = JSON.parse(
      readRepoFile(result.repoRoot, ".claude", "settings.local.json"),
    ) as Record<string, unknown>;
    const claudeSharedSettings = JSON.parse(
      readRepoFile(result.repoRoot, ".claude", "settings.json"),
    ) as Record<string, unknown>;
    const geminiSettings = JSON.parse(
      readRepoFile(result.repoRoot, ".gemini", "settings.json"),
    ) as Record<string, unknown>;
    const gitignore = readRepoFile(result.repoRoot, ".gitignore");
    const agents = readRepoFile(result.repoRoot, AGENTS_FILENAME);
    const claudeMemory = readRepoFile(result.repoRoot, CLAUDE_FILENAME);
    const skill = readRepoFile(
      result.repoRoot,
      ".codex",
      "skills",
      "reporag-mcp-usage",
      "SKILL.md",
    );
    const claudeGuidance = readRepoFile(result.repoRoot, ...CLAUDE_GUIDANCE_SEGMENTS);
    const wrapperPath = path.join(result.repoRoot, ".reporag", "run-mcp-server.cjs");

    expect(codexConfig).toContain('[mcp_servers.reporag]');
    expect(fs.existsSync(wrapperPath)).toBe(true);
    expect(claudeMcp).toHaveProperty("mcpServers.reporag");
    expect(claudeSettings).toHaveProperty("enabledMcpjsonServers");
    expect(claudeSettings).toHaveProperty("enabledMcpjsonServers", ["reporag"]);
    expect(claudeSettings).toHaveProperty("enableAllProjectMcpServers", true);
    expect(claudeSharedSettings).toHaveProperty("enableAllProjectMcpServers", true);
    expect(geminiSettings).toHaveProperty("mcpServers.reporag");
    expect(gitignore).toContain(".codex/config.toml");
    expect(gitignore).toContain(".codex/skills/reporag-mcp-usage/");
    expect(gitignore).toContain(".mcp.json");
    expect(gitignore).toContain(".claude/settings.local.json");
    expect(gitignore).toContain(".claude/settings.json");
    expect(gitignore).toContain(".gemini/settings.json");
    expect(agents).toContain(MANAGED_BLOCK_START);
    expect(agents).toContain("reporag-mcp-usage");
    expect(agents).toContain(".codex/skills/reporag-mcp-usage/SKILL.md");
    expect(agents).toContain("`reporag` MCP");
    expect(claudeMemory).toContain(CLAUDE_BLOCK_START);
    expect(claudeMemory).toContain("@.claude/reporag-mcp.md");
    expect(skill).toContain("`reporag`");
    expect(skill).toContain("repository_rag");
    expect(skill).toContain("get_symbol");
    expect(skill).toContain("find_callers");
    expect(skill).toContain("find_callees");
    expect(skill).toContain("search_code");
    expect(skill).toContain("path#symbol");
    expect(skill).toContain("Parent.symbol");
    expect(skill).toContain("path#Parent.symbol");
    expect(skill).toContain("matchedSymbols");
    expect(skill).toContain("reporag index");
    expect(skill).toContain("snapshot:index");
    expect(claudeGuidance).toContain("`reporag`");
    expect(claudeGuidance).toContain("repository_rag");
    expect(claudeGuidance).toContain("get_symbol");
    expect(claudeGuidance).toContain("find_callers");
    expect(claudeGuidance).toContain("find_callees");
    expect(claudeGuidance).toContain("search_code");
    expect(claudeGuidance).toContain("path#symbol");
    expect(claudeGuidance).toContain("Parent.symbol");
    expect(claudeGuidance).toContain("path#Parent.symbol");
    expect(claudeGuidance).toContain("matchedSymbols");
    expect(claudeGuidance).toContain("reporag index");
    expect(claudeGuidance).toContain("snapshot:index");
    expect(codexConfig).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(codexConfig).toContain(JSON.stringify([wrapperPath]));
    expect(claudeMcp).toHaveProperty(
      "mcpServers.reporag.command",
      process.execPath,
    );
    expect(claudeMcp).toHaveProperty(
      "mcpServers.reporag.args",
      [wrapperPath],
    );
    expect(claudeMcp).toHaveProperty("mcpServers.reporag.type", "stdio");
  });

  it("removes legacy repository_rag Gemini config while preserving unrelated servers", () => {
    fs.mkdirSync(path.join(tempRepo, ".gemini"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, ".gemini", "settings.json"),
      `${JSON.stringify(
        {
          theme: "light",
          mcpServers: {
            repository_rag: {
              command: "node",
              args: ["legacy-server.js"],
            },
            docs: {
              command: "node",
              args: ["docs-server.js"],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const geminiSettings = JSON.parse(
      readRepoFile(result.repoRoot, ".gemini", "settings.json"),
    ) as Record<string, unknown>;

    expect(geminiSettings).toHaveProperty("theme", "light");
    expect(geminiSettings).toHaveProperty("mcpServers.docs");
    expect(geminiSettings).not.toHaveProperty("mcpServers.repository_rag");
    expect(geminiSettings).toHaveProperty("mcpServers.reporag.command", process.execPath);
  });

  it("preserves existing AGENTS content while appending the managed block", () => {
    const existingAgents = [
      "# AGENTS",
      "",
      "Project-specific guidance that should stay.",
      "",
      "## Existing Rules",
      "- Keep tests green.",
      "",
      "Footer note.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tempRepo, AGENTS_FILENAME), existingAgents, "utf8");

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const agents = readRepoFile(result.repoRoot, AGENTS_FILENAME);

    expect(agents).toContain("Project-specific guidance that should stay.");
    expect(agents).toContain("- Keep tests green.");
    expect(agents).toContain("Footer note.");
    expect(agents).toContain(MANAGED_BLOCK_START);
    expect(agents.match(new RegExp(escapeForRegExp(MANAGED_BLOCK_START), "gu"))).toHaveLength(
      1,
    );
  });

  it("updates an existing managed AGENTS block without duplicating it", () => {
    const staleAgents = [
      "# AGENTS",
      "",
      "Intro that must remain.",
      "",
      MANAGED_BLOCK_START,
      "outdated guidance",
      "<!-- END reporag managed repository_rag guidance -->",
      "",
      "Tail that must remain.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tempRepo, AGENTS_FILENAME), staleAgents, "utf8");

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const agents = readRepoFile(result.repoRoot, AGENTS_FILENAME);

    expect(agents).toContain("Intro that must remain.");
    expect(agents).toContain("Tail that must remain.");
    expect(agents).not.toContain("outdated guidance");
    expect(agents.match(new RegExp(escapeForRegExp(MANAGED_BLOCK_START), "gu"))).toHaveLength(
      1,
    );
  });

  it("preserves existing Codex config while appending the managed MCP block", () => {
    const existingCodexConfig = [
      'model = "gpt-5.3-codex"',
      'approval_policy = "on-request"',
      "",
      "[profiles.existing]",
      'model = "gpt-5.4"',
      "",
    ].join("\n");
    fs.mkdirSync(path.join(tempRepo, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, ".codex", "config.toml"),
      existingCodexConfig,
      "utf8",
    );

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const codexConfig = readRepoFile(result.repoRoot, ".codex", "config.toml");

    expect(codexConfig).toContain('model = "gpt-5.3-codex"');
    expect(codexConfig).toContain('approval_policy = "on-request"');
    expect(codexConfig).toContain("[profiles.existing]");
    expect(codexConfig).toContain('[mcp_servers.reporag]');
    expect(codexConfig.match(/# BEGIN reporag managed reporag MCP/gu)).toHaveLength(1);
  });

  it("updates an existing managed Codex MCP block without removing unrelated config", () => {
    const staleCodexConfig = [
      'model = "gpt-5.3-codex"',
      "",
      "# BEGIN reporag managed reporag MCP",
      "[mcp_servers.reporag]",
      'command = "node"',
      'args = ["old.js"]',
      "# END reporag managed reporag MCP",
      "",
      "[profiles.existing]",
      'model = "gpt-5.4"',
      "",
    ].join("\n");
    fs.mkdirSync(path.join(tempRepo, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRepo, ".codex", "config.toml"),
      staleCodexConfig,
      "utf8",
    );

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const codexConfig = readRepoFile(result.repoRoot, ".codex", "config.toml");

    expect(codexConfig).toContain('model = "gpt-5.3-codex"');
    expect(codexConfig).toContain("[profiles.existing]");
    expect(codexConfig).not.toContain('args = ["old.js"]');
    expect(codexConfig).toContain('[mcp_servers.reporag]');
    expect(codexConfig.match(/# BEGIN reporag managed reporag MCP/gu)).toHaveLength(1);
  });

  it("preserves dollar signs when replacing an existing managed Codex MCP block", () => {
    const staleCodexConfig = [
      'model = "gpt-5.3-codex"',
      "",
      "# BEGIN reporag managed reporag MCP",
      "[mcp_servers.reporag]",
      'command = "node"',
      'args = ["old.js"]',
      "# END reporag managed reporag MCP",
      "",
    ].join("\n");

    const codexConfig = upsertCodexMcpConfig(staleCodexConfig, {
      command: "/tmp/cash$$app/bin/node",
      args: ["/tmp/$HOME/run-mcp-server.cjs"],
      cwd: "/tmp/project$workspace",
      env: {
        MCP_TOKEN: "token$$value",
      },
    });

    expect(codexConfig).toContain('command = "/tmp/cash$$app/bin/node"');
    expect(codexConfig).toContain('args    = ["/tmp/$HOME/run-mcp-server.cjs"]');
    expect(codexConfig).toContain(`cwd     = ${JSON.stringify("/tmp/project$workspace")}`);
    expect(codexConfig).toContain('MCP_TOKEN = "token$$value"');
  });

  it("preserves existing CLAUDE.md content while appending the managed import block", () => {
    const existingClaude = [
      "# CLAUDE",
      "",
      "Repo instructions that should stay.",
      "",
      "## Existing Memory",
      "- Prefer small changes.",
      "",
      "Footer note.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tempRepo, CLAUDE_FILENAME), existingClaude, "utf8");

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const claudeMemory = readRepoFile(result.repoRoot, CLAUDE_FILENAME);

    expect(claudeMemory).toContain("Repo instructions that should stay.");
    expect(claudeMemory).toContain("- Prefer small changes.");
    expect(claudeMemory).toContain("Footer note.");
    expect(claudeMemory).toContain(CLAUDE_BLOCK_START);
    expect(claudeMemory).toContain("@.claude/reporag-mcp.md");
    expect(
      claudeMemory.match(new RegExp(escapeForRegExp(CLAUDE_BLOCK_START), "gu")),
    ).toHaveLength(1);
  });

  it("updates an existing managed CLAUDE.md block without duplicating it", () => {
    const staleClaude = [
      "# CLAUDE",
      "",
      "Intro that must remain.",
      "",
      CLAUDE_BLOCK_START,
      "outdated guidance",
      "<!-- END reporag managed Claude repository_rag guidance -->",
      "",
      "Tail that must remain.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tempRepo, CLAUDE_FILENAME), staleClaude, "utf8");

    const result = initRepository(tempRepo, CLI_ENTRY);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const claudeMemory = readRepoFile(result.repoRoot, CLAUDE_FILENAME);

    expect(claudeMemory).toContain("Intro that must remain.");
    expect(claudeMemory).toContain("Tail that must remain.");
    expect(claudeMemory).not.toContain("outdated guidance");
    expect(
      claudeMemory.match(new RegExp(escapeForRegExp(CLAUDE_BLOCK_START), "gu")),
    ).toHaveLength(1);
  });

  it("keeps AGENTS, CLAUDE and generated guidance idempotent across reruns", () => {
    const firstResult = initRepository(tempRepo, CLI_ENTRY);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) {
      return;
    }

    const firstAgents = readRepoFile(firstResult.repoRoot, AGENTS_FILENAME);
    const firstSkill = readRepoFile(firstResult.repoRoot, ...SKILL_SEGMENTS);
    const firstClaudeMemory = readRepoFile(firstResult.repoRoot, CLAUDE_FILENAME);
    const firstClaudeGuidance = readRepoFile(
      firstResult.repoRoot,
      ...CLAUDE_GUIDANCE_SEGMENTS,
    );
    const firstGitignore = readRepoFile(firstResult.repoRoot, ".gitignore");

    const secondResult = initRepository(tempRepo, CLI_ENTRY);
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) {
      return;
    }

    const secondAgents = readRepoFile(secondResult.repoRoot, AGENTS_FILENAME);
    const secondSkill = readRepoFile(secondResult.repoRoot, ...SKILL_SEGMENTS);
    const secondClaudeMemory = readRepoFile(secondResult.repoRoot, CLAUDE_FILENAME);
    const secondClaudeGuidance = readRepoFile(
      secondResult.repoRoot,
      ...CLAUDE_GUIDANCE_SEGMENTS,
    );
    const secondGitignore = readRepoFile(secondResult.repoRoot, ".gitignore");

    expect(secondResult.alreadyInitialized).toBe(true);
    expect(secondAgents).toBe(firstAgents);
    expect(secondSkill).toBe(firstSkill);
    expect(secondClaudeMemory).toBe(firstClaudeMemory);
    expect(secondClaudeGuidance).toBe(firstClaudeGuidance);
    expect(secondGitignore).toBe(firstGitignore);
  });
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
