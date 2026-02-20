import fs from "node:fs";
import path from "node:path";

import type { DoctorCheck, DoctorResult } from "@reporag/shared";
import { ensureDatabase, ensureReporagLayout, openDatabase } from "@reporag/adapters";
import { getRepositoryStatus } from "./symbols";

function safeReadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

export function runDoctor(repoRoot: string): DoctorResult {
  const { repoDir, dbPath } = ensureReporagLayout(repoRoot);
  const configPath = path.join(repoDir, "config.json");
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "reporag-dir",
    ok: fs.existsSync(repoDir),
    details: fs.existsSync(repoDir)
      ? `.reporag directory exists at ${repoDir}`
      : `.reporag directory is missing at ${repoDir}`,
  });

  checks.push({
    name: "config-present",
    ok: fs.existsSync(configPath),
    details: fs.existsSync(configPath)
      ? `config file found at ${configPath}`
      : "config.json is missing; run `reporag init`",
  });

  if (fs.existsSync(configPath)) {
    try {
      const config = safeReadJson(configPath) as {
        include?: unknown;
        exclude?: unknown;
      };
      const includeCount = Array.isArray(config.include) ? config.include.length : 0;
      const excludeCount = Array.isArray(config.exclude) ? config.exclude.length : 0;

      checks.push({
        name: "config-valid-json",
        ok: true,
        details: `config is valid JSON with ${includeCount} include patterns and ${excludeCount} exclude patterns`,
      });
    } catch (error) {
      checks.push({
        name: "config-valid-json",
        ok: false,
        details:
          error instanceof Error ? error.message : "config.json is not valid JSON",
      });
    }
  }

  try {
    ensureDatabase(dbPath);
    checks.push({
      name: "sqlite-open",
      ok: true,
      details: `SQLite database is accessible at ${dbPath}`,
    });
  } catch (error) {
    checks.push({
      name: "sqlite-open",
      ok: false,
      details: error instanceof Error ? error.message : "Failed to open SQLite database",
    });
  }

  const status = getRepositoryStatus(repoRoot);

  if (status.initialized) {
    const db = openDatabase(status.dbPath);
    try {
      const schemaVersion = db
        .prepare("SELECT value FROM index_metadata WHERE key = 'schema_version'")
        .get() as { value?: string } | undefined;
      const lastIndexedAt = db
        .prepare("SELECT value FROM index_metadata WHERE key = 'last_indexed_at'")
        .get() as { value?: string } | undefined;

      checks.push({
        name: "schema-version",
        ok: Boolean(schemaVersion?.value),
        details: schemaVersion?.value
          ? `schema_version=${schemaVersion.value}`
          : "schema_version metadata missing",
      });

      checks.push({
        name: "index-content",
        ok: status.counts.files > 0 && status.counts.symbols > 0 && status.counts.chunks > 0,
        details:
          status.counts.files > 0
            ? `files=${status.counts.files}, symbols=${status.counts.symbols}, relations=${status.counts.relations}, chunks=${status.counts.chunks}`
            : "index is empty; run `reporag index`",
      });

      checks.push({
        name: "index-fresh",
        ok: status.freshness === "fresh",
        details:
          status.freshness === "fresh"
            ? "index is synchronized with the working tree"
            : `index is stale; pending added=${status.pendingChanges.added}, changed=${status.pendingChanges.changed}, removed=${status.pendingChanges.removed}`,
      });

      checks.push({
        name: "last-indexed-at",
        ok: Boolean(status.lastIndexedAt ?? lastIndexedAt?.value),
        details: status.lastIndexedAt ?? lastIndexedAt?.value
          ? `last indexed at ${status.lastIndexedAt ?? lastIndexedAt?.value}`
          : "last_indexed_at metadata missing",
      });
    } finally {
      db.close();
    }
  } else {
    checks.push({
      name: "index-content",
      ok: false,
      details: "repository is not initialized; run `reporag init`",
    });
  }

  const summary = checks.every((check) => check.ok) ? "healthy" : "warning";

  return {
    ok: true,
    repoRoot,
    summary,
    checks,
  };
}
