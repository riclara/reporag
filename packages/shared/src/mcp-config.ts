import path from "node:path";

export const REPORAG_MCP_SERVER_NAME = "reporag";
export const LEGACY_REPORAG_MCP_SERVER_NAMES = ["repository_rag"] as const;

export const PROJECT_CODEX_CONFIG_RELATIVE_PATH = path.join(".codex", "config.toml");
export const PROJECT_CLAUDE_MCP_RELATIVE_PATH = ".mcp.json";
export const PROJECT_CLAUDE_SETTINGS_RELATIVE_PATH = path.join(
  ".claude",
  "settings.local.json",
);
export const PROJECT_CLAUDE_SHARED_SETTINGS_RELATIVE_PATH = path.join(
  ".claude",
  "settings.json",
);
export const PROJECT_GEMINI_SETTINGS_RELATIVE_PATH = path.join(
  ".gemini",
  "settings.json",
);
export const PROJECT_MCP_WRAPPER_RELATIVE_PATH = path.join(
  ".reporag",
  "run-mcp-server.cjs",
);

export type McpCommandConfig = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};

function omitManagedMcpServerNames(
  servers: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...(servers ?? {}) };

  delete next[REPORAG_MCP_SERVER_NAME];
  for (const legacyName of LEGACY_REPORAG_MCP_SERVER_NAMES) {
    delete next[legacyName];
  }

  return next;
}

export function buildCodexMcpConfig(config: McpCommandConfig): string {
  const lines = [
    `# BEGIN reporag managed ${REPORAG_MCP_SERVER_NAME} MCP`,
    `[mcp_servers.${REPORAG_MCP_SERVER_NAME}]`,
    `command = ${JSON.stringify(config.command)}`,
    `args    = ${JSON.stringify(config.args)}`,
    "startup_timeout_sec = 30",
  ];

  if (config.cwd) {
    lines.push(`cwd     = ${JSON.stringify(path.resolve(config.cwd))}`);
  }

  lines.push(`# END reporag managed ${REPORAG_MCP_SERVER_NAME} MCP`, "");

  return lines.join("\n");
}

export function buildClaudeMcpConfig(config: McpCommandConfig): Record<string, unknown> {
  return {
    mcpServers: {
      [REPORAG_MCP_SERVER_NAME]: {
        type: "stdio",
        command: config.command,
        args: config.args,
        ...(config.env ? { env: config.env } : {}),
      },
    },
  };
}

export function buildClaudeSettingsConfig(): Record<string, unknown> {
  return {
    enableAllProjectMcpServers: true,
    enabledMcpjsonServers: [REPORAG_MCP_SERVER_NAME],
  };
}

export function buildGeminiSettingsConfig(
  existing: Record<string, unknown> | null,
  config: McpCommandConfig,
): Record<string, unknown> {
  const existingMcpServers =
    (existing?.mcpServers as Record<string, unknown> | undefined) ?? undefined;

  return {
    ...(existing ?? {}),
    mcpServers: {
      ...omitManagedMcpServerNames(existingMcpServers),
      [REPORAG_MCP_SERVER_NAME]: {
        command: config.command,
        args: config.args,
        ...(config.env ? { env: config.env } : {}),
      },
    },
  };
}
