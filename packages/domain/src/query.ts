import {
  type QueryHit,
  type QueryResult,
  queryInputSchema,
} from "@reporag/shared";
import {
  cosineSimilarity,
  openDatabase,
  resolveEmbeddingProvider,
} from "@reporag/adapters";

import { ensureFreshIndex } from "./fresh-index";
import { loadRepositoryConfig } from "./repository-state";

type QueryRepositoryInput = {
  query: string;
  limit?: number;
  stalePolicy?: "fail" | "warn" | "auto-index-light";
};

type CandidateRow = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
};

type FtsRow = CandidateRow & {
  chunkId: number;
  rank: number;
};

type EmbeddingRow = {
  chunkId: number;
  embeddingJson: string;
};

type ExpansionContext = {
  expandedTerms: string[];
  pathHints: string[];
  symbolHints: string[];
};

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildHit(
  row: CandidateRow,
  score: number,
  reasons: string[],
): QueryHit {
  return {
    filePath: row.filePath,
    symbolName: row.symbolName ?? undefined,
    startLine: row.startLine,
    endLine: row.endLine,
    score: Number(score.toFixed(2)),
    rationale: reasons.join("; "),
  };
}

function buildFtsQuery(query: string): string {
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    return `"${query.trim().replace(/"/g, "\"\"")}"`;
  }

  return tokens.map((token) => `${token}*`).join(" AND ");
}

function escapeFtsToken(token: string): string {
  return token.replace(/["*]/gu, "");
}

function buildExpandedFtsQuery(tokens: string[], expandedTerms: string[]): string {
  const uniqueTerms = [...new Set([...tokens, ...expandedTerms])]
    .map((token) => escapeFtsToken(token))
    .filter((token) => token.length >= 2);

  if (uniqueTerms.length === 0) {
    return "";
  }

  return uniqueTerms.map((token) => `${token}*`).join(" OR ");
}

function singularize(token: string): string {
  return token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token;
}

function expandNaturalLanguageTokens(tokens: string[]): string[] {
  const synonyms = new Map<string, string[]>([
    ["handler", ["handle", "processor", "consumer"]],
    ["message", ["messages", "payload", "event"]],
    ["webhook", ["hook", "endpoint", "controller"]],
    ["status", ["state", "health"]],
    ["config", ["configuration", "settings"]],
    ["auth", ["authentication", "token"]],
  ]);

  const expanded = new Set<string>();

  for (const token of tokens) {
    expanded.add(token);
    expanded.add(singularize(token));

    for (const synonym of synonyms.get(token) ?? []) {
      expanded.add(synonym);
    }
  }

  return [...expanded].filter((token) => token.length >= 2);
}

function collectExpansionContext(
  db: ReturnType<typeof openDatabase>,
  tokens: string[],
  limit: number,
): ExpansionContext {
  const expandedTerms = expandNaturalLanguageTokens(tokens);
  if (expandedTerms.length === 0) {
    return {
      expandedTerms: [],
      pathHints: [],
      symbolHints: [],
    };
  }

  const likeClauses = expandedTerms.map(() => "lower(name) LIKE ?").join(" OR ");
  const symbolRows = db.prepare(
    `SELECT DISTINCT name
     FROM symbols
     WHERE ${likeClauses}
     ORDER BY exported DESC, name ASC
     LIMIT ?`,
  ).all(
    ...expandedTerms.map((term) => `%${term}%`),
    Math.max(limit, 12),
  ) as Array<{ name: string }>;

  const fileClauses = expandedTerms.map(() => "lower(path) LIKE ?").join(" OR ");
  const fileRows = db.prepare(
    `SELECT DISTINCT path
     FROM files
     WHERE ${fileClauses}
     ORDER BY path ASC
     LIMIT ?`,
  ).all(
    ...expandedTerms.map((term) => `%${term}%`),
    Math.max(limit, 12),
  ) as Array<{ path: string }>;

  return {
    expandedTerms,
    symbolHints: symbolRows.map((row) => row.name.toLowerCase()),
    pathHints: fileRows.map((row) => row.path.toLowerCase()),
  };
}

function rerankFtsRow(
  row: FtsRow,
  normalizedQuery: string,
  tokens: string[],
  expansionContext: ExpansionContext,
  embeddingSimilarity = 0,
): QueryHit {
  const filePath = row.filePath.toLowerCase();
  const symbolName = (row.symbolName ?? "").toLowerCase();
  const content = row.content.toLowerCase();
  let score = Math.max(1, 120 - Math.max(0, row.rank));
  const reasons = ["fts lexical match"];

  if (symbolName === normalizedQuery) {
    score += 50;
    reasons.push("exact symbol match");
  } else if (symbolName.includes(normalizedQuery)) {
    score += 18;
    reasons.push("query matched symbol name");
  }

  if (filePath.includes(normalizedQuery)) {
    score += 10;
    reasons.push("query matched file path");
  }

  if (content.includes(normalizedQuery)) {
    score += 8;
    reasons.push("query matched chunk content");
  }

  let tokenMatches = 0;
  for (const token of tokens) {
    let matched = false;
    if (symbolName.includes(token)) {
      score += 6;
      matched = true;
    }
    if (filePath.includes(token)) {
      score += 4;
      matched = true;
    }
    if (content.includes(token)) {
      score += 2;
      matched = true;
    }
    if (matched) {
      tokenMatches += 1;
    }
  }

  if (tokenMatches > 0) {
    reasons.push(`matched ${tokenMatches} query tokens`);
  }

  let conceptualMatches = 0;
  for (const hint of expansionContext.symbolHints) {
    if (symbolName.includes(hint)) {
      score += 8;
      conceptualMatches += 1;
      break;
    }
  }

  for (const hint of expansionContext.pathHints) {
    if (filePath.includes(hint)) {
      score += 6;
      conceptualMatches += 1;
      break;
    }
  }

  if (conceptualMatches > 0) {
    reasons.push("matched expanded structural hints");
  }

  if (embeddingSimilarity > 0) {
    score += embeddingSimilarity * 40;
    reasons.push(`embedding similarity ${embeddingSimilarity.toFixed(2)}`);
  }

  return buildHit(row, score, reasons);
}

export function queryRepository(
  repoRoot: string,
  rawInput: QueryRepositoryInput,
): QueryResult {
  try {
    const input = queryInputSchema.parse({
      repoRoot,
      intent: "hybrid-search",
      query: rawInput.query,
      limit: rawInput.limit,
      stalePolicy: rawInput.stalePolicy,
    });
    const freshness = ensureFreshIndex(repoRoot, input.stalePolicy);
    if (!freshness.ok) {
      return {
        ok: false,
        code:
          freshness.code === "REPO_NOT_INITIALIZED"
            ? "REPO_NOT_INITIALIZED"
            : freshness.reason === "refresh-failed"
              ? "INDEX_REFRESH_FAILED"
              : "INDEX_STALE",
        message: freshness.message,
        retryable: freshness.retryable,
      };
    }

    const queryText = input.query;
    if (!queryText) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "query is required",
        retryable: false,
      };
    }

    const config = loadRepositoryConfig(repoRoot);
    if (!config) {
      return {
        ok: false,
        code: "REPO_NOT_INITIALIZED",
        message: "Repository not initialized. Run `reporag init` first.",
        retryable: false,
      };
    }

    const normalizedQuery = queryText.toLowerCase().trim();
    const db = openDatabase(freshness.dbPath);
    const embeddingProvider = resolveEmbeddingProvider(config);

    try {
      const exactSymbolRows = db
        .prepare(
          `SELECT
             f.path AS filePath,
             s.name AS symbolName,
             s.start_line AS startLine,
             s.end_line AS endLine,
             COALESCE(c.content, s.name) AS content
           FROM symbols s
           JOIN files f ON f.id = s.file_id
           LEFT JOIN chunks c ON c.symbol_id = s.id
           WHERE lower(s.name) = ?
           ORDER BY s.exported DESC, f.path ASC
           LIMIT ?`,
        )
        .all(normalizedQuery, input.limit) as CandidateRow[];

      if (exactSymbolRows.length > 0) {
        return {
          ok: true,
          route: "symbol",
          stale: freshness.stale,
          hits: exactSymbolRows.map((row) =>
            buildHit(row, 200, ["exact symbol match"]),
          ),
        };
      }

      const tokens = tokenizeQuery(queryText);
      const expansionContext = collectExpansionContext(db, tokens, input.limit);
      const ftsQueries = [
        buildFtsQuery(queryText),
        buildExpandedFtsQuery(tokens, expansionContext.expandedTerms),
      ].filter((query, index, array) => query.length > 0 && array.indexOf(query) === index);

      const candidateMap = new Map<number, FtsRow>();

      for (const ftsQuery of ftsQueries) {
        const rows = db
          .prepare(
            `SELECT
               c.id AS chunkId,
               f.path AS filePath,
               s.name AS symbolName,
               c.start_line AS startLine,
               c.end_line AS endLine,
               c.content AS content,
               bm25(chunks_fts, 1.0, 0.5, 1.5) AS rank
             FROM chunks_fts
             JOIN chunks c ON c.id = chunks_fts.rowid
             JOIN files f ON f.id = c.file_id
             LEFT JOIN symbols s ON s.id = c.symbol_id
             WHERE chunks_fts MATCH ?
             ORDER BY rank ASC
             LIMIT ?`,
          )
          .all(ftsQuery, Math.max(input.limit * 6, 24)) as FtsRow[];

        for (const row of rows) {
          const previous = candidateMap.get(row.chunkId);
          if (!previous || row.rank < previous.rank) {
            candidateMap.set(row.chunkId, row);
          }
        }
      }

      const candidates = [...candidateMap.values()];

      const similaritiesByChunkId = new Map<number, number>();

      if (embeddingProvider && candidates.length > 0) {
        const queryEmbedding = embeddingProvider.embedTexts([queryText])[0] ?? [];
        const embeddingRows = db.prepare(
          `SELECT chunk_id AS chunkId, embedding_json AS embeddingJson
           FROM chunk_embeddings
           WHERE model = ?
             AND chunk_id IN (${candidates.map(() => "?").join(", ")})`,
        ).all(
          embeddingProvider.model,
          ...candidates.map((candidate) => candidate.chunkId),
        ) as EmbeddingRow[];

        for (const row of embeddingRows) {
          const similarity = cosineSimilarity(
            queryEmbedding,
            JSON.parse(row.embeddingJson) as number[],
          );
          similaritiesByChunkId.set(row.chunkId, similarity);
        }
      }

      const usedEmbeddings = similaritiesByChunkId.size > 0;
      const hits = candidates
        .map((row) =>
          rerankFtsRow(
            row,
            normalizedQuery,
            tokens,
            expansionContext,
            similaritiesByChunkId.get(row.chunkId) ?? 0,
          ),
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, input.limit);

      return {
        ok: true,
        route: usedEmbeddings ? "hybrid" : "fts",
        stale: freshness.stale,
        hits,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: error instanceof Error ? error.message : "Invalid query input",
      retryable: false,
    };
  }
}
