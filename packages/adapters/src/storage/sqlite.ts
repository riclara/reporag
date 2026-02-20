import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const REPO_DIR = ".reporag";
const DB_FILENAME = "index.sqlite";

export function ensureReporagLayout(repoRoot: string): {
  repoDir: string;
  dbPath: string;
} {
  const repoDir = path.join(repoRoot, REPO_DIR);
  const dbPath = path.join(repoDir, DB_FILENAME);

  if (!fs.existsSync(repoDir)) {
    fs.mkdirSync(repoDir, { recursive: true });
  }

  return { repoDir, dbPath };
}

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function ensureDatabase(dbPath: string): void {
  const db = openDatabase(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      language TEXT NOT NULL,
      sha1 TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0
    );
  `);

  const fileColumns = new Set(
    (
      db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>
    ).map((column) => column.name),
  );

  if (!fileColumns.has("size_bytes")) {
    db.exec(
      "ALTER TABLE files ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!fileColumns.has("mtime_ms")) {
    db.exec(
      "ALTER TABLE files ADD COLUMN mtime_ms INTEGER NOT NULL DEFAULT 0",
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      parent_symbol_id INTEGER,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      signature TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_symbol_id INTEGER NOT NULL,
      target_symbol_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      FOREIGN KEY (source_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE,
      FOREIGN KEY (target_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      symbol_id INTEGER,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content_sha1 TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content,
      file_path,
      symbol_name,
      tokenize = 'porter unicode61'
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_symbol_id ON chunks(symbol_id);
    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model);
  `);

  const stmt = db.prepare(
    `INSERT INTO index_metadata (key, value)
     VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  stmt.run({
    key: "schema_version",
    value: "2",
  });

  db.close();
}

export type UpsertFileRow = {
  path: string;
  language: string;
  sha1: string;
  updated_at: string;
  size_bytes: number;
  mtime_ms: number;
};

export function clearArtifactsForFile(
  db: Database.Database,
  fileId: number,
): void {
  db.prepare(
    `DELETE FROM chunks_fts
     WHERE rowid IN (SELECT id FROM chunks WHERE file_id = ?)`,
  ).run(fileId);
  db.prepare(
    `DELETE FROM chunk_embeddings
     WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = ?)`,
  ).run(fileId);
  db.prepare(
    `DELETE FROM relations
     WHERE source_symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)
        OR target_symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)`,
  ).run(fileId, fileId);
  db.prepare("DELETE FROM chunks WHERE file_id = ?").run(fileId);
  db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);
}

export function syncFilesInDatabase(
  db: Database.Database,
  rows: UpsertFileRow[],
): {
  inserted: number;
  updated: number;
  removed: number;
  fileIdsByPath: Map<string, number>;
} {
  const selectStmt = db.prepare(
    "SELECT id, sha1, language, size_bytes AS sizeBytes, mtime_ms AS mtimeMs FROM files WHERE path = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO files (path, language, sha1, updated_at, size_bytes, mtime_ms)
     VALUES (@path, @language, @sha1, @updated_at, @size_bytes, @mtime_ms)`,
  );
  const updateStmt = db.prepare(
    `UPDATE files
     SET language=@language,
         sha1=@sha1,
         updated_at=@updated_at,
         size_bytes=@size_bytes,
         mtime_ms=@mtime_ms
     WHERE path=@path`,
  );
  const selectAllStmt = db.prepare("SELECT id, path FROM files");
  const deleteFileStmt = db.prepare("DELETE FROM files WHERE id = ?");

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  const activePaths = new Set(rows.map((row) => row.path));

  for (const row of rows) {
    const existing = selectStmt.get(row.path) as
      | {
          id: number;
          sha1: string;
          language: string;
          sizeBytes: number;
          mtimeMs: number;
        }
      | undefined;

    if (!existing) {
      insertStmt.run(row);
      inserted += 1;
      continue;
    }

    if (
      existing.sha1 !== row.sha1 ||
      existing.language !== row.language ||
      existing.sizeBytes !== row.size_bytes ||
      existing.mtimeMs !== row.mtime_ms
    ) {
      updateStmt.run(row);
      updated += 1;
    }
  }

  const existingRows = selectAllStmt.all() as Array<{ id: number; path: string }>;

  for (const existing of existingRows) {
    if (activePaths.has(existing.path)) {
      continue;
    }

    clearArtifactsForFile(db, existing.id);
    deleteFileStmt.run(existing.id);
    removed += 1;
  }

  const remainingRows = selectAllStmt.all() as Array<{ id: number; path: string }>;
  const fileIdsByPath = new Map(
    remainingRows.map((row) => [row.path, row.id] as const),
  );

  return { inserted, updated, removed, fileIdsByPath };
}
