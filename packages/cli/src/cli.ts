#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { CodeIntelService, runMcpServer } from "@reporag/app";

import { checkForUpdate, formatUpdateMessage } from "./update-check";

const CLI_PACKAGE_JSON_PATH = path.resolve(__dirname, "..", "package.json");

function getRepoRoot(): string {
  const envRepoRoot = process.env.REPORAG_REPO_ROOT?.trim();
  return envRepoRoot && envRepoRoot.length > 0
    ? path.resolve(envRepoRoot)
    : process.cwd();
}

function getCliVersion(): string {
  const packageJson = JSON.parse(
    fs.readFileSync(CLI_PACKAGE_JSON_PATH, "utf8"),
  ) as { version?: string };

  return packageJson.version ?? "0.0.0";
}

function printInitResult() {
  const repoRoot = getRepoRoot();
  const cliEntryPath = process.argv[1];
  const result = CodeIntelService.init(repoRoot, cliEntryPath);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] init failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  const relativeConfig = path.relative(repoRoot, result.configPath);
  const relativeDb = path.relative(repoRoot, result.dbPath);

  // eslint-disable-next-line no-console
  console.log("[reporag] Initialized repository:");
  // eslint-disable-next-line no-console
  console.log(`  repoRoot: ${result.repoRoot}`);
  // eslint-disable-next-line no-console
  console.log(`  config:   ${relativeConfig}`);
  // eslint-disable-next-line no-console
  console.log(`  db:       ${relativeDb}`);
  // eslint-disable-next-line no-console
  console.log(
    `  status:   ${result.alreadyInitialized ? "updated" : "created"}`
  );

  const indexResult = CodeIntelService.index(result.repoRoot);
  if (!indexResult.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] post-init index failed: ${indexResult.message}`);
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[reporag] Initial index completed:");
  // eslint-disable-next-line no-console
  console.log(`  scanned:  ${indexResult.scanned}`);
  // eslint-disable-next-line no-console
  console.log(`  symbols:  ${indexResult.symbols}`);
  // eslint-disable-next-line no-console
  console.log(`  relations:${indexResult.relations}`);
  // eslint-disable-next-line no-console
  console.log(`  chunks:   ${indexResult.chunks}`);
}

function printIndexResult() {
  const repoRoot = getRepoRoot();
  const result = CodeIntelService.index(repoRoot);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] index failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[reporag] Index completed:");
  // eslint-disable-next-line no-console
  console.log(`  scanned:  ${result.scanned}`);
  // eslint-disable-next-line no-console
  console.log(`  inserted: ${result.inserted}`);
  // eslint-disable-next-line no-console
  console.log(`  updated:  ${result.updated}`);
  // eslint-disable-next-line no-console
  console.log(`  removed:  ${result.removed}`);
  // eslint-disable-next-line no-console
  console.log(`  symbols:  ${result.symbols}`);
  // eslint-disable-next-line no-console
  console.log(`  relations:${result.relations}`);
  // eslint-disable-next-line no-console
  console.log(`  chunks:   ${result.chunks}`);
}

function printQueryResult() {
  const repoRoot = getRepoRoot();
  const [, , , ...queryParts] = process.argv;
  const query = queryParts.join(" ").trim();

  const result = CodeIntelService.query(repoRoot, query);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] query failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[reporag] No matches found.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[reporag] Query route: ${result.route}`);
  if (result.stale) {
    // eslint-disable-next-line no-console
    console.log("[reporag] Warning: serving results from a stale index.");
  }

  for (const [index, hit] of result.hits.entries()) {
    // eslint-disable-next-line no-console
    console.log(
      `${index + 1}. ${hit.filePath}:${hit.startLine}-${hit.endLine} score=${hit.score}`
    );
    if (hit.symbolName) {
      // eslint-disable-next-line no-console
      console.log(`   symbol: ${hit.symbolName}`);
    }
    // eslint-disable-next-line no-console
    console.log(`   why:    ${hit.rationale}`);
  }
}

function printSymbolResult() {
  const repoRoot = getRepoRoot();
  const [, , , ...parts] = process.argv;
  const symbolName = parts.join(" ").trim();
  const result = CodeIntelService.symbol(repoRoot, symbolName);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] symbol failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[reporag] No symbol matches found.");
    return;
  }

  for (const [index, hit] of result.hits.entries()) {
    // eslint-disable-next-line no-console
    console.log(
      `${index + 1}. ${hit.symbolName} (${hit.kind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`
    );
    if (hit.parentSymbolName) {
      // eslint-disable-next-line no-console
      console.log(`   parent: ${hit.parentSymbolName}`);
    }
    // eslint-disable-next-line no-console
    console.log(`   exported: ${hit.exported ? "yes" : "no"}`);
  }
}

function printCallersResult() {
  const repoRoot = getRepoRoot();
  const [, , , ...parts] = process.argv;
  const symbolName = parts.join(" ").trim();
  const result = CodeIntelService.callers(repoRoot, symbolName);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] callers failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[reporag] No callers found for ${result.targetSymbolName}.`);
    return;
  }

  if (result.matchedSymbols.length > 1) {
    // eslint-disable-next-line no-console
    console.log(`[reporag] Matched ${result.matchedSymbols.length} symbols for ${result.targetSymbolName}:`);
    for (const [index, match] of result.matchedSymbols.entries()) {
      // eslint-disable-next-line no-console
      console.log(
        `   ${index + 1}. ${match.parentSymbolName ? `${match.parentSymbolName}.` : ""}${match.symbolName} ${match.filePath}:${match.startLine}-${match.endLine}`
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[reporag] Callers of ${result.targetSymbolName}:`);
  for (const [index, hit] of result.hits.entries()) {
    // eslint-disable-next-line no-console
    console.log(
      `${index + 1}. ${hit.callerSymbolName} (${hit.callerKind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`
    );
    if (hit.callerParentSymbolName) {
      // eslint-disable-next-line no-console
      console.log(`   parent: ${hit.callerParentSymbolName}`);
    }
  }
}

function printCalleesResult() {
  const repoRoot = getRepoRoot();
  const [, , , ...parts] = process.argv;
  const symbolName = parts.join(" ").trim();
  const result = CodeIntelService.callees(repoRoot, symbolName);

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`[reporag] callees failed: ${result.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[reporag] No callees found for ${result.sourceSymbolName}.`);
    return;
  }

  if (result.matchedSymbols.length > 1) {
    // eslint-disable-next-line no-console
    console.log(`[reporag] Matched ${result.matchedSymbols.length} symbols for ${result.sourceSymbolName}:`);
    for (const [index, match] of result.matchedSymbols.entries()) {
      // eslint-disable-next-line no-console
      console.log(
        `   ${index + 1}. ${match.parentSymbolName ? `${match.parentSymbolName}.` : ""}${match.symbolName} ${match.filePath}:${match.startLine}-${match.endLine}`
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[reporag] Callees of ${result.sourceSymbolName}:`);
  for (const [index, hit] of result.hits.entries()) {
    // eslint-disable-next-line no-console
    console.log(
      `${index + 1}. ${hit.calleeSymbolName} (${hit.calleeKind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`
    );
    if (hit.calleeParentSymbolName) {
      // eslint-disable-next-line no-console
      console.log(`   parent: ${hit.calleeParentSymbolName}`);
    }
  }
}

function printStatusResult() {
  const repoRoot = getRepoRoot();
  const result = CodeIntelService.status(repoRoot);

  // eslint-disable-next-line no-console
  console.log("[reporag] Repository status:");
  // eslint-disable-next-line no-console
  console.log(`  repoRoot:    ${result.repoRoot}`);
  // eslint-disable-next-line no-console
  console.log(`  initialized: ${result.initialized ? "yes" : "no"}`);
  // eslint-disable-next-line no-console
  console.log(`  freshness:   ${result.freshness}`);
  // eslint-disable-next-line no-console
  console.log(`  config:      ${path.relative(repoRoot, result.configPath)}`);
  // eslint-disable-next-line no-console
  console.log(`  db:          ${path.relative(repoRoot, result.dbPath)}`);
  // eslint-disable-next-line no-console
  console.log(`  lastIndexed: ${result.lastIndexedAt ?? "never"}`);
  // eslint-disable-next-line no-console
  console.log(
    `  pending:     added=${result.pendingChanges.added} changed=${result.pendingChanges.changed} removed=${result.pendingChanges.removed}`,
  );
  // eslint-disable-next-line no-console
  console.log(`  files:       ${result.counts.files}`);
  // eslint-disable-next-line no-console
  console.log(`  symbols:     ${result.counts.symbols}`);
  // eslint-disable-next-line no-console
  console.log(`  relations:   ${result.counts.relations}`);
  // eslint-disable-next-line no-console
  console.log(`  chunks:      ${result.counts.chunks}`);
}

function printDoctorResult() {
  const repoRoot = getRepoRoot();
  const result = CodeIntelService.doctor(repoRoot);

  // eslint-disable-next-line no-console
  console.log(`[reporag] Doctor summary: ${result.summary}`);
  for (const check of result.checks) {
    // eslint-disable-next-line no-console
    console.log(`- ${check.ok ? "OK" : "WARN"} ${check.name}: ${check.details}`);
  }

  if (result.summary !== "healthy") {
    process.exitCode = 1;
  }
}

async function main() {
  const [, , command, subcommand] = process.argv;
  const currentVersion = getCliVersion();

  switch (command) {
    case "--version":
    case "-v":
    case "version":
      // eslint-disable-next-line no-console
      console.log(currentVersion);
      break;
    case "init":
      printInitResult();
      break;
    case "index":
      printIndexResult();
      break;
    case "query":
      printQueryResult();
      break;
    case "symbol":
      printSymbolResult();
      break;
    case "callers":
      printCallersResult();
      break;
    case "callees":
      printCalleesResult();
      break;
    case "status":
      printStatusResult();
      break;
    case "doctor":
      printDoctorResult();
      break;
    case "mcp":
      if (subcommand === "serve") {
        await runMcpServer(getRepoRoot());
        return;
      }
      // eslint-disable-next-line no-console
      console.log("Usage:");
      // eslint-disable-next-line no-console
      console.log("  reporag mcp serve");
      process.exitCode = 1;
      break;
    default:
      // eslint-disable-next-line no-console
      console.log("reporag CLI");
      // eslint-disable-next-line no-console
      console.log("Usage:");
      // eslint-disable-next-line no-console
      console.log("  reporag init");
      // eslint-disable-next-line no-console
      console.log("  reporag index");
      // eslint-disable-next-line no-console
      console.log("  reporag query <text>");
      // eslint-disable-next-line no-console
      console.log("  reporag symbol <name>");
      // eslint-disable-next-line no-console
      console.log("  reporag callers <symbol>");
      // eslint-disable-next-line no-console
      console.log("  reporag callees <symbol>");
      // eslint-disable-next-line no-console
      console.log("  reporag status");
      // eslint-disable-next-line no-console
      console.log("  reporag doctor");
      // eslint-disable-next-line no-console
      console.log("  reporag mcp serve");
      // eslint-disable-next-line no-console
      console.log("  reporag --version");
      process.exitCode = 1;
  }

  const update = await checkForUpdate(currentVersion);
  if (update) {
    // eslint-disable-next-line no-console
    console.error(formatUpdateMessage(update));
  }
}

void main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    `[reporag] fatal error: ${
      error instanceof Error ? error.message : "Unknown error"
    }`,
  );
  process.exit(1);
});
