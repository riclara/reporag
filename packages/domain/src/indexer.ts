import crypto from "node:crypto";
import fs from "node:fs";

import ts from "typescript";

import { type IndexResult } from "@reporag/shared";
import {
  clearArtifactsForFile,
  extractSymbolsFromSource,
  openDatabase,
  resolveEmbeddingProvider,
  type RawRelation,
  type RawSymbol,
} from "@reporag/adapters";

import {
  type CurrentRepoFile,
  inspectRepositoryIndexState,
} from "./repository-state";

type ParsedFileArtifacts = {
  file: CurrentRepoFile;
  sourceText: string;
  sha1: string;
  symbols: RawSymbol[];
  relations: RawRelation[];
};

type IndexedFileSnapshot = {
  id: number;
  path: string;
  language: string;
  sha1: string;
  sizeBytes: number;
  mtimeMs: number;
};

type StoredSymbolRow = {
  id: number;
  filePath: string;
  symbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  parentSymbolName?: string;
};

function sha1Text(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function isSemanticSource(filePath: string): boolean {
  return (
    filePath.endsWith(".ts") ||
    filePath.endsWith(".tsx") ||
    filePath.endsWith(".js") ||
    filePath.endsWith(".jsx")
  );
}

function parseFileArtifacts(
  file: CurrentRepoFile,
  program: ts.Program | null,
): ParsedFileArtifacts {
  const sourceText = fs.readFileSync(file.absolutePath, "utf8");

  return {
    file,
    sourceText,
    sha1: sha1Text(sourceText),
    ...extractSymbolsFromSource(file.path, sourceText, {
      absoluteFilePath: file.absolutePath,
      program: program ?? undefined,
    }),
  };
}

function buildSymbolIdentityKey(input: {
  kind: string;
  name: string;
  parentName?: string;
  startLine: number;
  endLine: number;
}): string {
  return [
    input.kind,
    input.name,
    input.parentName ?? "",
    input.startLine,
    input.endLine,
  ].join(":");
}

function loadStoredSymbols(
  db: ReturnType<typeof openDatabase>,
): StoredSymbolRow[] {
  return db.prepare(
    `SELECT
       s.id AS id,
       f.path AS filePath,
       s.name AS symbolName,
       s.kind AS kind,
       s.start_line AS startLine,
       s.end_line AS endLine,
       s.exported AS exported,
       parent.name AS parentSymbolName
     FROM symbols s
     JOIN files f ON f.id = s.file_id
     LEFT JOIN symbols parent ON parent.id = s.parent_symbol_id
     ORDER BY f.path ASC, s.start_line ASC`,
  ).all().map((row) => {
    const symbol = row as {
      id: number;
      filePath: string;
      symbolName: string;
      kind: string;
      startLine: number;
      endLine: number;
      exported: number;
      parentSymbolName?: string | null;
    };

    return {
      id: symbol.id,
      filePath: symbol.filePath,
      symbolName: symbol.symbolName,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      exported: Boolean(symbol.exported),
      parentSymbolName: symbol.parentSymbolName ?? undefined,
    };
  });
}

function buildSemanticProgram(currentFiles: CurrentRepoFile[]): ts.Program | null {
  const semanticFiles = currentFiles
    .filter((file) => isSemanticSource(file.path))
    .map((file) => file.absolutePath);

  if (semanticFiles.length === 0) {
    return null;
  }

  return ts.createProgram(semanticFiles, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
  });
}

function embedInBatches<T>(
  items: string[],
  runBatch: (batch: string[]) => T[],
  batchSize = 32,
): T[] {
  const results: T[] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const batchResults = runBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

export function indexRepository(repoRoot: string): IndexResult {
  try {
    const state = inspectRepositoryIndexState(repoRoot);

    if (!state.initialized || !state.config) {
      return {
        ok: false,
        repoRoot,
        errorCode: "REPO_NOT_INITIALIZED",
        message: "Repository not initialized. Run `reporag init` first.",
      };
    }

    const now = new Date().toISOString();
    const indexedByPath = new Map(
      state.indexedFiles.map((file) => [file.path, file] as const),
    );
    const currentPaths = new Set(state.currentFiles.map((file) => file.path));
    const removedFiles = state.indexedFiles.filter((file) => !currentPaths.has(file.path));
    const semanticProgram = buildSemanticProgram(state.currentFiles);

    const metadataOnlyFiles: Array<{
      file: CurrentRepoFile;
      existing: IndexedFileSnapshot;
    }> = [];
    const reprocessedFiles = new Map<string, ParsedFileArtifacts>();

    for (const file of state.currentFiles) {
      const existing = indexedByPath.get(file.path) as IndexedFileSnapshot | undefined;

      if (
        existing &&
        existing.language === file.language &&
        existing.sizeBytes === file.sizeBytes &&
        existing.mtimeMs === file.mtimeMs
      ) {
        continue;
      }

      const parsed = parseFileArtifacts(file, semanticProgram);
      if (
        existing &&
        existing.language === file.language &&
        existing.sha1 === parsed.sha1
      ) {
        metadataOnlyFiles.push({
          file,
          existing,
        });
        continue;
      }

      reprocessedFiles.set(file.path, parsed);
    }

    const shouldRebuildRelations =
      removedFiles.length > 0 || reprocessedFiles.size > 0;
    const relationArtifactsByPath = new Map<string, ParsedFileArtifacts>();

    if (shouldRebuildRelations) {
      for (const file of state.currentFiles) {
        const cached = reprocessedFiles.get(file.path);
        relationArtifactsByPath.set(
          file.path,
          cached ?? parseFileArtifacts(file, semanticProgram),
        );
      }
    }

    const db = openDatabase(state.dbPath);

    try {
      const embeddingProvider = resolveEmbeddingProvider(state.config);
      const pendingEmbeddings: Array<{ chunkId: number; content: string }> = [];

      const insertFile = db.prepare(
        `INSERT INTO files (path, language, sha1, updated_at, size_bytes, mtime_ms)
         VALUES (@path, @language, @sha1, @updated_at, @size_bytes, @mtime_ms)`,
      );
      const updateFile = db.prepare(
        `UPDATE files
         SET language=@language,
             sha1=@sha1,
             updated_at=@updated_at,
             size_bytes=@size_bytes,
             mtime_ms=@mtime_ms
         WHERE id=@id`,
      );
      const updateFileMetadata = db.prepare(
        `UPDATE files
         SET language=@language,
             updated_at=@updated_at,
             size_bytes=@size_bytes,
             mtime_ms=@mtime_ms
         WHERE id=@id`,
      );
      const deleteFile = db.prepare("DELETE FROM files WHERE id = ?");
      const insertSymbol = db.prepare(
        `INSERT INTO symbols
          (file_id, parent_symbol_id, name, kind, signature, start_line, end_line, exported)
         VALUES
          (@file_id, @parent_symbol_id, @name, @kind, @signature, @start_line, @end_line, @exported)`,
      );
      const insertChunk = db.prepare(
        `INSERT INTO chunks
          (file_id, symbol_id, chunk_type, content, start_line, end_line, content_sha1)
         VALUES
          (@file_id, @symbol_id, @chunk_type, @content, @start_line, @end_line, @content_sha1)`,
      );
      const insertChunkFts = db.prepare(
        `INSERT INTO chunks_fts (rowid, content, file_path, symbol_name)
         VALUES (@rowid, @content, @file_path, @symbol_name)`,
      );
      const upsertChunkEmbedding = db.prepare(
        `INSERT INTO chunk_embeddings
          (chunk_id, model, dimensions, embedding_json, updated_at)
         VALUES
          (@chunk_id, @model, @dimensions, @embedding_json, @updated_at)
         ON CONFLICT(chunk_id) DO UPDATE SET
           model = excluded.model,
           dimensions = excluded.dimensions,
           embedding_json = excluded.embedding_json,
           updated_at = excluded.updated_at`,
      );
      const clearRelations = db.prepare("DELETE FROM relations");
      const insertRelation = db.prepare(
        `INSERT INTO relations
          (source_symbol_id, target_symbol_id, relation_type)
         VALUES
          (@source_symbol_id, @target_symbol_id, @relation_type)`,
      );
      const upsertMetadata = db.prepare(
        `INSERT INTO index_metadata (key, value)
         VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );

    let inserted = 0;
    let updated = 0;
    let removed = 0;
    let symbolCount = 0;
    let chunkCount = 0;
    let relationCount = 0;

    const writeFileArtifacts = (
      fileId: number,
      artifacts: ParsedFileArtifacts,
    ): void => {
      const localSymbolIds = new Map<string, number>();

      for (const symbol of artifacts.symbols) {
        const parentSymbolId = symbol.parentLocalKey
          ? localSymbolIds.get(symbol.parentLocalKey) ?? null
          : null;
        const insertResult = insertSymbol.run({
          file_id: fileId,
          parent_symbol_id: parentSymbolId,
          name: symbol.name,
          kind: symbol.kind,
          signature: symbol.signature ?? null,
          start_line: symbol.startLine,
          end_line: symbol.endLine,
          exported: symbol.exported ? 1 : 0,
        });
        const symbolId = Number(insertResult.lastInsertRowid);
        localSymbolIds.set(symbol.localKey, symbolId);
        symbolCount += 1;

        const chunkResult = insertChunk.run({
          file_id: fileId,
          symbol_id: symbolId,
          chunk_type: "symbol",
          content: symbol.content,
          start_line: symbol.startLine,
          end_line: symbol.endLine,
          content_sha1: sha1Text(symbol.content),
        });
        insertChunkFts.run({
          rowid: Number(chunkResult.lastInsertRowid),
          content: symbol.content,
          file_path: artifacts.file.path,
          symbol_name: symbol.name,
        });
        pendingEmbeddings.push({
          chunkId: Number(chunkResult.lastInsertRowid),
          content: symbol.content,
        });
        chunkCount += 1;
      }
    };

      const tx = db.transaction(() => {
      for (const removedFile of removedFiles) {
        clearArtifactsForFile(db, removedFile.id);
        deleteFile.run(removedFile.id);
        removed += 1;
      }

      for (const { file, existing } of metadataOnlyFiles) {
        updateFileMetadata.run({
          id: existing.id,
          language: file.language,
          updated_at: now,
          size_bytes: file.sizeBytes,
          mtime_ms: file.mtimeMs,
        });
        updated += 1;
      }

      for (const artifacts of reprocessedFiles.values()) {
        const existing = indexedByPath.get(artifacts.file.path);

        if (existing) {
          updateFile.run({
            id: existing.id,
            path: artifacts.file.path,
            language: artifacts.file.language,
            sha1: artifacts.sha1,
            updated_at: now,
            size_bytes: artifacts.file.sizeBytes,
            mtime_ms: artifacts.file.mtimeMs,
          });
          clearArtifactsForFile(db, existing.id);
          writeFileArtifacts(existing.id, artifacts);
          updated += 1;
          continue;
        }

        const insertResult = insertFile.run({
          path: artifacts.file.path,
          language: artifacts.file.language,
          sha1: artifacts.sha1,
          updated_at: now,
          size_bytes: artifacts.file.sizeBytes,
          mtime_ms: artifacts.file.mtimeMs,
        });
        writeFileArtifacts(Number(insertResult.lastInsertRowid), artifacts);
        inserted += 1;
      }

      if (shouldRebuildRelations) {
        clearRelations.run();

        const storedSymbols = loadStoredSymbols(db);
        const symbolsByName = new Map<
          string,
          Array<{
            id: number;
            filePath: string;
            exported: boolean;
            parentName?: string;
          }>
        >();
        const storedSymbolsByFile = new Map<string, Map<string, number>>();

        for (const symbol of storedSymbols) {
          const existingByName = symbolsByName.get(symbol.symbolName) ?? [];
          existingByName.push({
            id: symbol.id,
            filePath: symbol.filePath,
            exported: symbol.exported,
            parentName: symbol.parentSymbolName,
          });
          symbolsByName.set(symbol.symbolName, existingByName);

          const existingByFile = storedSymbolsByFile.get(symbol.filePath) ?? new Map();
          existingByFile.set(
            buildSymbolIdentityKey({
              kind: symbol.kind,
              name: symbol.symbolName,
              parentName: symbol.parentSymbolName,
              startLine: symbol.startLine,
              endLine: symbol.endLine,
            }),
            symbol.id,
          );
          storedSymbolsByFile.set(symbol.filePath, existingByFile);
        }

        for (const [filePath, artifacts] of relationArtifactsByPath.entries()) {
          const storedSymbolsForFile = storedSymbolsByFile.get(filePath);
          if (!storedSymbolsForFile) {
            continue;
          }

          const localSymbolIds = new Map<string, number>();
          for (const symbol of artifacts.symbols) {
            const symbolId = storedSymbolsForFile.get(
              buildSymbolIdentityKey({
                kind: symbol.kind,
                name: symbol.name,
                parentName: symbol.parentName,
                startLine: symbol.startLine,
                endLine: symbol.endLine,
              }),
            );

            if (symbolId) {
              localSymbolIds.set(symbol.localKey, symbolId);
            }
          }

          for (const relation of artifacts.relations) {
            const sourceSymbolId = localSymbolIds.get(relation.sourceLocalKey);
            if (!sourceSymbolId) {
              continue;
            }

            const candidates = symbolsByName.get(relation.targetName);
            if (!candidates || candidates.length === 0) {
              continue;
            }

            const scopedCandidates = relation.targetParentName
              ? candidates.filter(
                  (candidate) => candidate.parentName === relation.targetParentName,
                )
              : candidates;
            const eligibleCandidates =
              scopedCandidates.length > 0 ? scopedCandidates : candidates;

            const target =
              eligibleCandidates.find((candidate) => candidate.filePath === filePath) ??
              eligibleCandidates.find((candidate) => candidate.exported) ??
              eligibleCandidates[0];

            if (!target) {
              continue;
            }

            insertRelation.run({
              source_symbol_id: sourceSymbolId,
              target_symbol_id: target.id,
              relation_type: relation.relationType,
            });
            relationCount += 1;
          }
        }
      }

      upsertMetadata.run({
        key: "last_indexed_at",
        value: now,
      });
      });

      tx();

      if (embeddingProvider) {
        const embeddingTargets = new Map<number, string>(
          pendingEmbeddings.map((item) => [item.chunkId, item.content] as const),
        );
        const missingEmbeddings = db.prepare(
          `SELECT
             c.id AS chunkId,
             c.content AS content
           FROM chunks c
           LEFT JOIN chunk_embeddings ce ON ce.chunk_id = c.id
           WHERE ce.chunk_id IS NULL OR ce.model != ?
           ORDER BY c.id ASC`,
        ).all(embeddingProvider.model) as Array<{ chunkId: number; content: string }>;

        for (const item of missingEmbeddings) {
          if (!embeddingTargets.has(item.chunkId)) {
            embeddingTargets.set(item.chunkId, item.content);
          }
        }

        if (embeddingTargets.size > 0) {
          try {
            const embeddingItems = [...embeddingTargets.entries()].map(
              ([chunkId, content]) => ({ chunkId, content }),
            );
            const embeddings = embedInBatches(
              embeddingItems.map((item) => item.content),
              (batch) => embeddingProvider.embedTexts(batch),
            );

            const writeEmbeddings = db.transaction(() => {
              for (const [index, embedding] of embeddings.entries()) {
                const target = embeddingItems[index];
                if (!target || embedding.length === 0) {
                  continue;
                }

                upsertChunkEmbedding.run({
                  chunk_id: target.chunkId,
                  model: embeddingProvider.model,
                  dimensions: embeddingProvider.dimensions,
                  embedding_json: JSON.stringify(embedding),
                  updated_at: now,
                });
              }
            });

            writeEmbeddings();
          } catch {
            // Keep indexing useful even when embeddings are unavailable.
          }
        }
      }

      return {
        ok: true,
        repoRoot,
        scanned: reprocessedFiles.size,
        inserted,
        updated,
        removed,
        symbols: symbolCount,
        relations: relationCount,
        chunks: chunkCount,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      repoRoot,
      errorCode: "FS_ERROR",
      message: error instanceof Error ? error.message : "Unknown error during index",
    };
  }
}
