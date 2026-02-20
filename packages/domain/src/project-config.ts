import fs from "node:fs";
import path from "node:path";

import {
  buildClaudeMcpConfig,
  buildClaudeSettingsConfig,
  buildCodexMcpConfig,
  buildGeminiSettingsConfig,
  type McpCommandConfig,
  PROJECT_CLAUDE_MCP_RELATIVE_PATH,
  PROJECT_CLAUDE_SETTINGS_RELATIVE_PATH,
  PROJECT_CODEX_CONFIG_RELATIVE_PATH,
  PROJECT_GEMINI_SETTINGS_RELATIVE_PATH,
  PROJECT_MCP_WRAPPER_RELATIVE_PATH,
} from "@reporag/shared";

type WriteMode = "created" | "updated" | "unchanged";

type ConfigWriteResult = {
  path: string;
  mode: WriteMode;
};

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath: string, content: string): ConfigWriteResult {
  const exists = fs.existsSync(filePath);
  const previous = exists ? fs.readFileSync(filePath, "utf8") : null;

  if (previous === content) {
    return { path: filePath, mode: "unchanged" };
  }

  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
  return { path: filePath, mode: exists ? "updated" : "created" };
}

function readOptionalJson(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function writeJsonFile(
  filePath: string,
  value: Record<string, unknown>,
): ConfigWriteResult {
  return writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeProjectMcpClientConfigs(targetRoot: string): {
  codex: ConfigWriteResult;
  claudeMcp: ConfigWriteResult;
  claudeSettings: ConfigWriteResult;
  geminiSettings: ConfigWriteResult;
} {
  const root = path.resolve(targetRoot);
  const localCliEntry = path.join(root, "packages", "cli", "bundle", "reporag.cjs");
  const wrapperPath = path.join(root, PROJECT_MCP_WRAPPER_RELATIVE_PATH);
  const cliRuntimePath = fs.existsSync(localCliEntry)
    ? fs.realpathSync(localCliEntry)
    : null;

  if (!cliRuntimePath) {
    throw new Error("Unable to locate reporag CLI runtime for MCP wrapper generation");
  }

  const wrapperSource = [
    "const { spawn } = require('node:child_process');",
    "",
    `const repoRoot = ${JSON.stringify(root)};`,
    `const cliRuntimePath = ${JSON.stringify(cliRuntimePath)};`,
    "",
    "const child = spawn(",
    "  process.execPath,",
    "  [cliRuntimePath, 'mcp', 'serve'],",
    "  {",
    "    cwd: repoRoot,",
    "    env: { ...process.env, REPORAG_REPO_ROOT: repoRoot },",
    "    stdio: 'inherit',",
    "  },",
    ");",
    "",
    "const forwardSignal = (signal) => {",
    "  if (!child.killed) {",
    "    child.kill(signal);",
    "  }",
    "};",
    "",
    "process.once('SIGINT', () => {",
    "  forwardSignal('SIGINT');",
    "});",
    "",
    "process.once('SIGTERM', () => {",
    "  forwardSignal('SIGTERM');",
    "});",
    "",
    "child.on('exit', (code, signal) => {",
    "  if (signal) {",
    "    process.kill(process.pid, signal);",
    "    return;",
    "  }",
    "",
    "  process.exit(code ?? 1);",
    "});",
    "",
    "child.on('error', (error) => {",
    "  console.error('Failed to launch reporag MCP server:', error);",
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");

  ensureParentDir(wrapperPath);
  fs.writeFileSync(wrapperPath, wrapperSource, "utf8");

  const commandConfig: McpCommandConfig = {
    command: process.execPath,
    args: [wrapperPath],
    cwd: root,
  };
  const codexPath = path.join(root, PROJECT_CODEX_CONFIG_RELATIVE_PATH);
  const claudeMcpPath = path.join(root, PROJECT_CLAUDE_MCP_RELATIVE_PATH);
  const claudeSettingsPath = path.join(root, PROJECT_CLAUDE_SETTINGS_RELATIVE_PATH);
  const geminiSettingsPath = path.join(root, PROJECT_GEMINI_SETTINGS_RELATIVE_PATH);

  const codex = writeTextFile(codexPath, buildCodexMcpConfig(commandConfig));
  const claudeMcp = writeJsonFile(claudeMcpPath, buildClaudeMcpConfig(commandConfig));

  const existingClaudeSettings = readOptionalJson(claudeSettingsPath);
  const nextClaudeSettings = {
    ...(existingClaudeSettings ?? {}),
    ...buildClaudeSettingsConfig(),
  };
  const claudeSettings = writeJsonFile(claudeSettingsPath, nextClaudeSettings);

  const existingGeminiSettings = readOptionalJson(geminiSettingsPath);
  const geminiSettings = writeJsonFile(
    geminiSettingsPath,
    buildGeminiSettingsConfig(existingGeminiSettings, commandConfig),
  );

  return {
    codex,
    claudeMcp,
    claudeSettings,
    geminiSettings,
  };
}
