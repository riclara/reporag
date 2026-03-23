import path from "node:path";

export const REPORAG_MCP_SERVER_NAME = "reporag";
export const LEGACY_REPORAG_MCP_SERVER_NAMES = ["repository_rag"] as const;
export const CODEX_MCP_BLOCK_START = `# BEGIN reporag managed ${REPORAG_MCP_SERVER_NAME} MCP`;
export const CODEX_MCP_BLOCK_END = `# END reporag managed ${REPORAG_MCP_SERVER_NAME} MCP`;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

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
    CODEX_MCP_BLOCK_START,
    `[mcp_servers.${REPORAG_MCP_SERVER_NAME}]`,
    `command = ${JSON.stringify(config.command)}`,
    `args    = ${JSON.stringify(config.args)}`,
    "startup_timeout_sec = 30",
  ];

  if (config.cwd) {
    lines.push(`cwd     = ${JSON.stringify(path.resolve(config.cwd))}`);
  }

  if (config.env && Object.keys(config.env).length > 0) {
    lines.push("", `[mcp_servers.${REPORAG_MCP_SERVER_NAME}.env]`);

    const envEntries = Object.entries(config.env).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    for (const [key, value] of envEntries) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  lines.push(CODEX_MCP_BLOCK_END, "");

  return lines.join("\n");
}

export function upsertCodexMcpConfig(
  current: string,
  config: McpCommandConfig,
): string {
  const normalized = current.replace(/\r\n/g, "\n");
  const managedBlock = buildCodexMcpConfig(config).trimEnd();
  const blockPattern = new RegExp(
    `${escapeRegExp(CODEX_MCP_BLOCK_START)}[\\s\\S]*?${escapeRegExp(CODEX_MCP_BLOCK_END)}`,
    "u",
  );

  if (blockPattern.test(normalized)) {
    return `${normalized.replace(blockPattern, () => managedBlock).trimEnd()}\n`;
  }

  if (normalized.trim().length === 0) {
    return `${managedBlock}\n`;
  }

  return `${normalized.trimEnd()}\n\n${managedBlock}\n`;
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
