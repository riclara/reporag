import fs from "node:fs";
import path from "node:path";

import fg from "fast-glob";

import type {
  PendingIndexChanges,
  RepoFreshness,
  ReporagConfig,
} from "@reporag/shared";
import {
  ensureDatabase,
  ensureReporagLayout,
  openDatabase,
} from "@reporag/adapters";
import { parseReporagConfig } from "@reporag/shared";

export type CurrentRepoFile = {
  path: string;
  absolutePath: string;
  language: "typescript" | "javascript";
  sizeBytes: number;
  mtimeMs: number;
};

export type IndexedRepoFile = {
  id: number;
  path: string;
  language: string;
  sha1: string;
  updatedAt: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type RepositoryIndexState = {
  repoRoot: string;
  repoDir: string;
  dbPath: string;
  configPath: string;
  initialized: boolean;
  config: ReporagConfig | null;
  currentFiles: CurrentRepoFile[];
  indexedFiles: IndexedRepoFile[];
  freshness: RepoFreshness;
  pendingChanges: PendingIndexChanges;
  lastIndexedAt?: string;
};

export function detectLanguage(
  filePath: string,
): "typescript" | "javascript" {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
    return "typescript";
  }

  return "javascript";
}

export function loadRepositoryConfig(repoRoot: string): ReporagConfig | null {
  const { repoDir } = ensureReporagLayout(repoRoot);
  const configPath = path.join(repoDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  return parseReporagConfig(
    JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown,
  );
}

export function collectCurrentRepositoryFiles(
  repoRoot: string,
  config: ReporagConfig,
): CurrentRepoFile[] {
  return fg
    .sync(config.include, {
      cwd: repoRoot,
      ignore: config.exclude,
      dot: true,
      onlyFiles: true,
      absolute: false,
    })
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => {
      const absolutePath = path.join(repoRoot, filePath);
      const stats = fs.statSync(absolutePath);

      return {
        path: filePath,
        absolutePath,
        language: detectLanguage(filePath),
        sizeBytes: stats.size,
        mtimeMs: Math.trunc(stats.mtimeMs),
      };
    });
}

export function listIndexedFiles(
  db: ReturnType<typeof openDatabase>,
): IndexedRepoFile[] {
  return db.prepare(
    `SELECT
       id,
       path,
       language,
       sha1,
       updated_at AS updatedAt,
       size_bytes AS sizeBytes,
       mtime_ms AS mtimeMs
     FROM files
     ORDER BY path ASC`,
  ).all() as IndexedRepoFile[];
}

export function readIndexMetadataValue(
  db: ReturnType<typeof openDatabase>,
  key: string,
): string | undefined {
  const row = db.prepare(
    "SELECT value FROM index_metadata WHERE key = ?",
  ).get(key) as { value?: string } | undefined;

  return row?.value;
}

export function calculatePendingChanges(
  currentFiles: CurrentRepoFile[],
  indexedFiles: IndexedRepoFile[],
): PendingIndexChanges {
  const indexedByPath = new Map(indexedFiles.map((file) => [file.path, file] as const));
  const currentPaths = new Set(currentFiles.map((file) => file.path));

  let added = 0;
  let changed = 0;

  for (const file of currentFiles) {
    const existing = indexedByPath.get(file.path);
    if (!existing) {
      added += 1;
      continue;
    }

    if (
      existing.language !== file.language ||
      existing.sizeBytes !== file.sizeBytes ||
      existing.mtimeMs !== file.mtimeMs
    ) {
      changed += 1;
    }
  }

  let removed = 0;
  for (const file of indexedFiles) {
    if (!currentPaths.has(file.path)) {
      removed += 1;
    }
  }

  return {
    added,
    changed,
    removed,
  };
}

export function inspectRepositoryIndexState(
  repoRoot: string,
): RepositoryIndexState {
  const { repoDir, dbPath } = ensureReporagLayout(repoRoot);
  const configPath = path.join(repoDir, "config.json");

  if (!fs.existsSync(configPath)) {
    return {
      repoRoot,
      repoDir,
      dbPath,
      configPath,
      initialized: false,
      config: null,
      currentFiles: [],
      indexedFiles: [],
      freshness: "stale",
      pendingChanges: {
        added: 0,
        changed: 0,
        removed: 0,
      },
    };
  }

  const config = loadRepositoryConfig(repoRoot);
  if (!config) {
    return {
      repoRoot,
      repoDir,
      dbPath,
      configPath,
      initialized: false,
      config: null,
      currentFiles: [],
      indexedFiles: [],
      freshness: "stale",
      pendingChanges: {
        added: 0,
        changed: 0,
        removed: 0,
      },
    };
  }

  ensureDatabase(dbPath);
  const currentFiles = collectCurrentRepositoryFiles(repoRoot, config);
  const db = openDatabase(dbPath);

  try {
    const indexedFiles = listIndexedFiles(db);
    const pendingChanges = calculatePendingChanges(currentFiles, indexedFiles);
    const lastIndexedAt = readIndexMetadataValue(db, "last_indexed_at");
    const freshness =
      pendingChanges.added === 0 &&
      pendingChanges.changed === 0 &&
      pendingChanges.removed === 0
        ? "fresh"
        : "stale";

    return {
      repoRoot,
      repoDir,
      dbPath,
      configPath,
      initialized: true,
      config,
      currentFiles,
      indexedFiles,
      freshness,
      pendingChanges,
      lastIndexedAt,
    };
  } finally {
    db.close();
  }
}
