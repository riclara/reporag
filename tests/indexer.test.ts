import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { initRepository, indexRepository } from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-index-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "packages", "demo", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "startup.ts"),
    [
      "export function helper() {",
      "  return 1;",
      "}",
      "",
      "export function run() {",
      "  return helper();",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function enableMockEmbeddings(repoRoot: string): void {
  const configPath = path.join(repoRoot, ".reporag", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    embeddings: Record<string, unknown>;
  };

  config.embeddings = {
    ...config.embeddings,
    enabled: true,
    provider: "mock",
    model: "mock-embeddings",
    dimensions: 64,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

function getDbPath(repoRoot: string): string {
  return path.join(repoRoot, ".reporag", "index.sqlite");
}

describe("indexRepository", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("indexes symbols, chunks and relations and removes stale file artifacts", () => {
    const initResult = initRepository(tempRepo);
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) {
      return;
    }

    enableMockEmbeddings(tempRepo);

    const firstIndex = indexRepository(tempRepo);
    expect(firstIndex.ok).toBe(true);
    if (!firstIndex.ok) {
      return;
    }

    expect(firstIndex.scanned).toBe(1);
    expect(firstIndex.symbols).toBeGreaterThanOrEqual(2);
    expect(firstIndex.chunks).toBeGreaterThanOrEqual(2);
    expect(firstIndex.relations).toBeGreaterThanOrEqual(1);

    const db = new Database(path.join(tempRepo, ".reporag", "index.sqlite"));

    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM files").get() as { count: number }).count),
    ).toBe(1);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM symbols").get() as { count: number }).count),
    ).toBeGreaterThanOrEqual(2);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM relations").get() as { count: number }).count),
    ).toBeGreaterThanOrEqual(1);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }).count),
    ).toBeGreaterThanOrEqual(2);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM chunks_fts").get() as { count: number }).count),
    ).toBeGreaterThanOrEqual(2);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM chunk_embeddings").get() as { count: number }).count),
    ).toBeGreaterThanOrEqual(2);
    db.close();

    fs.unlinkSync(path.join(tempRepo, "packages", "demo", "src", "startup.ts"));

    const secondIndex = indexRepository(tempRepo);
    expect(secondIndex.ok).toBe(true);
    if (!secondIndex.ok) {
      return;
    }

    expect(secondIndex.scanned).toBe(0);
    expect(secondIndex.removed).toBe(1);

    const dbAfterDelete = new Database(
      path.join(tempRepo, ".reporag", "index.sqlite"),
    );

    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM files").get() as { count: number }).count),
    ).toBe(0);
    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM symbols").get() as { count: number }).count),
    ).toBe(0);
    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM relations").get() as { count: number }).count),
    ).toBe(0);
    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }).count),
    ).toBe(0);
    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM chunks_fts").get() as { count: number }).count),
    ).toBe(0);
    expect(
      Number((dbAfterDelete.prepare("SELECT COUNT(*) AS count FROM chunk_embeddings").get() as { count: number }).count),
    ).toBe(0);
    dbAfterDelete.close();
  });

  it("reprocesses only the file whose content changed", () => {
    const initResult = initRepository(tempRepo);
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) {
      return;
    }

    const firstIndex = indexRepository(tempRepo);
    expect(firstIndex.ok).toBe(true);
    if (!firstIndex.ok) {
      return;
    }

    fs.writeFileSync(
      path.join(tempRepo, "packages", "demo", "src", "extra.ts"),
      "export function extra() { return 'ok'; }\n",
      "utf8",
    );

    const secondIndex = indexRepository(tempRepo);
    expect(secondIndex.ok).toBe(true);
    if (!secondIndex.ok) {
      return;
    }

    expect(secondIndex.scanned).toBe(1);
    expect(secondIndex.inserted).toBe(1);

    fs.writeFileSync(
      path.join(tempRepo, "packages", "demo", "src", "startup.ts"),
      [
        "export function helper() {",
        "  return 2;",
        "}",
        "",
        "export function run() {",
        "  return helper();",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const thirdIndex = indexRepository(tempRepo);
    expect(thirdIndex.ok).toBe(true);
    if (!thirdIndex.ok) {
      return;
    }

    expect(thirdIndex.scanned).toBe(1);
    expect(thirdIndex.updated).toBe(1);
    expect(thirdIndex.inserted).toBe(0);
  });

  it("updates file metadata without rebuilding artifacts when only mtime changes", () => {
    const initResult = initRepository(tempRepo);
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) {
      return;
    }

    const firstIndex = indexRepository(tempRepo);
    expect(firstIndex.ok).toBe(true);
    if (!firstIndex.ok) {
      return;
    }

    const dbBefore = new Database(getDbPath(tempRepo));
    const fileBefore = dbBefore.prepare(
      "SELECT mtime_ms AS mtimeMs FROM files WHERE path = ?",
    ).get("packages/demo/src/startup.ts") as { mtimeMs: number };
    const countsBefore = {
      symbols: Number((dbBefore.prepare("SELECT COUNT(*) AS count FROM symbols").get() as { count: number }).count),
      chunks: Number((dbBefore.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }).count),
      relations: Number((dbBefore.prepare("SELECT COUNT(*) AS count FROM relations").get() as { count: number }).count),
    };
    dbBefore.close();

    const startupPath = path.join(tempRepo, "packages", "demo", "src", "startup.ts");
    const nextTime = new Date(Date.now() + 5000);
    fs.utimesSync(startupPath, nextTime, nextTime);

    const secondIndex = indexRepository(tempRepo);
    expect(secondIndex.ok).toBe(true);
    if (!secondIndex.ok) {
      return;
    }

    expect(secondIndex.scanned).toBe(0);
    expect(secondIndex.updated).toBe(1);
    expect(secondIndex.symbols).toBe(0);
    expect(secondIndex.chunks).toBe(0);

    const dbAfter = new Database(getDbPath(tempRepo));
    const fileAfter = dbAfter.prepare(
      "SELECT mtime_ms AS mtimeMs FROM files WHERE path = ?",
    ).get("packages/demo/src/startup.ts") as { mtimeMs: number };
    expect(fileAfter.mtimeMs).toBeGreaterThan(fileBefore.mtimeMs);
    expect(
      Number((dbAfter.prepare("SELECT COUNT(*) AS count FROM symbols").get() as { count: number }).count),
    ).toBe(countsBefore.symbols);
    expect(
      Number((dbAfter.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }).count),
    ).toBe(countsBefore.chunks);
    expect(
      Number((dbAfter.prepare("SELECT COUNT(*) AS count FROM relations").get() as { count: number }).count),
    ).toBe(countsBefore.relations);
    dbAfter.close();
  });

  it("migrates a schema version 1 database in place", () => {
    const initResult = initRepository(tempRepo);
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) {
      return;
    }

    fs.rmSync(getDbPath(tempRepo), { force: true });

    const db = new Database(getDbPath(tempRepo));
    db.exec(`
      CREATE TABLE index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL,
        sha1 TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO index_metadata (key, value) VALUES ('schema_version', '1')",
    ).run();
    db.prepare(
      `INSERT INTO files (path, language, sha1, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "packages/demo/src/startup.ts",
      "typescript",
      "legacy",
      new Date(0).toISOString(),
    );
    db.close();

    const result = indexRepository(tempRepo);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const migratedDb = new Database(getDbPath(tempRepo));
    const schemaVersion = migratedDb.prepare(
      "SELECT value FROM index_metadata WHERE key = 'schema_version'",
    ).get() as { value: string };
    const columns = migratedDb.prepare("PRAGMA table_info(files)").all() as Array<{
      name: string;
    }>;

    expect(schemaVersion.value).toBe("2");
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["size_bytes", "mtime_ms"]),
    );
    migratedDb.close();
  });
});
