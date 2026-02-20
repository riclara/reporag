import type {
  CalleeHit,
  CallerHit,
  FindCalleesResult,
  FindCallersResult,
  RepoStatus,
  SymbolLookupResult,
} from "@reporag/shared";
import { openDatabase } from "@reporag/adapters";

import { ensureFreshIndex } from "./fresh-index";
import { inspectRepositoryIndexState } from "./repository-state";

type SymbolRow = {
  id: number;
  filePath: string;
  symbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
  exported: number;
  parentSymbolName?: string | null;
};

type SymbolSelector = {
  raw: string;
  symbolName: string;
  containerHint?: string;
  pathHint?: string;
};

type RelationCandidateRow = SymbolRow;

function parseScopedSymbolName(
  raw: string,
): Pick<SymbolSelector, "symbolName" | "containerHint"> {
  const scoped = raw.trim();
  const dotIndex = scoped.lastIndexOf(".");

  if (
    dotIndex > 0 &&
    dotIndex < scoped.length - 1 &&
    !scoped.slice(0, dotIndex).includes("/") &&
    !scoped.slice(0, dotIndex).includes("\\")
  ) {
    return {
      containerHint: scoped.slice(0, dotIndex).trim(),
      symbolName: scoped.slice(dotIndex + 1).trim(),
    };
  }

  return {
    symbolName: scoped,
  };
}

function parseSymbolSelector(input: string): SymbolSelector {
  const raw = input.trim();
  const hashIndex = raw.lastIndexOf("#");
  if (hashIndex > 0 && hashIndex < raw.length - 1) {
    const scopedSymbol = parseScopedSymbolName(raw.slice(hashIndex + 1).trim());

    return {
      raw,
      pathHint: raw.slice(0, hashIndex).trim(),
      ...scopedSymbol,
    };
  }

  return {
    raw,
    ...parseScopedSymbolName(raw),
  };
}

function toSymbolHit(row: SymbolRow) {
  return {
    filePath: row.filePath,
    symbolName: row.symbolName,
    kind: row.kind,
    startLine: row.startLine,
    endLine: row.endLine,
    exported: Boolean(row.exported),
    parentSymbolName: row.parentSymbolName ?? undefined,
  };
}

function buildSelectorWhereClause(
  selector: SymbolSelector,
  exactName: boolean,
): {
  whereClause: string;
  params: Array<string | number>;
} {
  const whereParts = [
    exactName ? "lower(s.name) = ?" : "lower(s.name) LIKE ?",
  ];
  const params: Array<string | number> = [
    exactName
      ? selector.symbolName.toLowerCase()
      : `%${selector.symbolName.toLowerCase()}%`,
  ];

  if (selector.containerHint) {
    whereParts.push("lower(coalesce(parent.name, '')) = ?");
    params.push(selector.containerHint.toLowerCase());
  }

  if (selector.pathHint) {
    whereParts.push("lower(f.path) LIKE ?");
    params.push(`%${selector.pathHint.toLowerCase()}%`);
  }

  return {
    whereClause: whereParts.join(" AND "),
    params,
  };
}

function selectSymbols(
  db: ReturnType<typeof openDatabase>,
  selector: SymbolSelector,
  limit: number,
  exactName: boolean,
): SymbolRow[] {
  const { whereClause, params } = buildSelectorWhereClause(selector, exactName);

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
     WHERE ${whereClause}
     ORDER BY
       CASE WHEN lower(s.name) = ? THEN 0 ELSE 1 END,
       CASE WHEN lower(coalesce(parent.name, '')) = ? THEN 0 ELSE 1 END,
       CASE WHEN lower(f.path) LIKE ? THEN 0 ELSE 1 END,
       s.exported DESC,
       f.path ASC,
       s.start_line ASC
     LIMIT ?`,
  ).all(
    ...params,
    selector.symbolName.toLowerCase(),
    selector.containerHint?.toLowerCase() ?? "",
    selector.pathHint ? `%${selector.pathHint.toLowerCase()}%` : "",
    limit,
  ) as SymbolRow[];
}

function resolveSymbolCandidates(
  db: ReturnType<typeof openDatabase>,
  selector: SymbolSelector,
  limit: number,
): RelationCandidateRow[] {
  const exactRows = selectSymbols(db, selector, limit, true);
  if (exactRows.length > 0) {
    return exactRows;
  }

  return selectSymbols(db, selector, limit, false);
}

function dedupeCallers(hits: CallerHit[]): CallerHit[] {
  const seen = new Set<string>();
  const deduped: CallerHit[] = [];

  for (const hit of hits) {
    const key = [
      hit.filePath,
      hit.callerSymbolName,
      hit.callerParentSymbolName ?? "",
      hit.startLine,
      hit.endLine,
      hit.relationType,
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(hit);
  }

  return deduped;
}

function dedupeCallees(hits: CalleeHit[]): CalleeHit[] {
  const seen = new Set<string>();
  const deduped: CalleeHit[] = [];

  for (const hit of hits) {
    const key = [
      hit.filePath,
      hit.calleeSymbolName,
      hit.calleeParentSymbolName ?? "",
      hit.startLine,
      hit.endLine,
      hit.relationType,
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(hit);
  }

  return deduped;
}

function ensureReadyForRead(repoRoot: string): {
  ok: true;
  dbPath: string;
} | {
  ok: false;
  code: "REPO_NOT_INITIALIZED" | "INDEX_REFRESH_FAILED";
  message: string;
  retryable: boolean;
} {
  const freshness = ensureFreshIndex(repoRoot, "auto-index-light");
  if (!freshness.ok) {
    if (freshness.code === "REPO_NOT_INITIALIZED") {
      return {
        ok: false,
        code: "REPO_NOT_INITIALIZED",
        message: freshness.message,
        retryable: freshness.retryable,
      };
    }

    return {
      ok: false,
      code: "INDEX_REFRESH_FAILED",
      message: freshness.message,
      retryable: freshness.retryable,
    };
  }

  return {
    ok: true,
    dbPath: freshness.dbPath,
  };
}

export function lookupSymbol(
  repoRoot: string,
  symbolName: string,
  limit = 10,
): SymbolLookupResult {
  const selector = parseSymbolSelector(symbolName);
  if (selector.symbolName.trim().length === 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "symbolName is required",
      retryable: false,
    };
  }

  const init = ensureReadyForRead(repoRoot);
  if (!init.ok) {
    return {
      ok: false,
      code: init.code,
      message: init.message,
      retryable: init.retryable,
    };
  }

  const db = openDatabase(init.dbPath);

  try {
    const rows = resolveSymbolCandidates(db, selector, limit);

    return {
      ok: true,
      hits: rows.map(toSymbolHit),
    };
  } finally {
    db.close();
  }
}

export function findCallers(
  repoRoot: string,
  symbolName: string,
  limit = 20,
): FindCallersResult {
  const selector = parseSymbolSelector(symbolName);
  if (selector.symbolName.trim().length === 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "symbolName is required",
      retryable: false,
    };
  }

  const init = ensureReadyForRead(repoRoot);
  if (!init.ok) {
    return {
      ok: false,
      code: init.code,
      message: init.message,
      retryable: init.retryable,
    };
  }

  const db = openDatabase(init.dbPath);

  try {
    const matchedSymbols = resolveSymbolCandidates(db, selector, 10);
    if (matchedSymbols.length === 0) {
      return {
        ok: true,
        targetSymbolName: symbolName,
        matchedSymbols: [],
        hits: [],
      };
    }

    const placeholders = matchedSymbols.map(() => "?").join(", ");
    const hits = db.prepare(
      `SELECT
         caller.name AS callerSymbolName,
         caller.kind AS callerKind,
         callerParent.name AS callerParentSymbolName,
         f.path AS filePath,
         caller.start_line AS startLine,
         caller.end_line AS endLine,
         r.relation_type AS relationType
       FROM relations r
       JOIN symbols caller ON caller.id = r.source_symbol_id
       LEFT JOIN symbols callerParent ON callerParent.id = caller.parent_symbol_id
       JOIN files f ON f.id = caller.file_id
       WHERE r.target_symbol_id IN (${placeholders})
       ORDER BY f.path ASC, caller.start_line ASC
       LIMIT ?`,
    ).all(
      ...matchedSymbols.map((row) => row.id),
      limit,
    ) as CallerHit[];

    return {
      ok: true,
      targetSymbolName: symbolName,
      matchedSymbols: matchedSymbols.map(toSymbolHit),
      hits: dedupeCallers(hits),
    };
  } finally {
    db.close();
  }
}

export function findCallees(
  repoRoot: string,
  symbolName: string,
  limit = 20,
): FindCalleesResult {
  const selector = parseSymbolSelector(symbolName);
  if (selector.symbolName.trim().length === 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "symbolName is required",
      retryable: false,
    };
  }

  const init = ensureReadyForRead(repoRoot);
  if (!init.ok) {
    return {
      ok: false,
      code: init.code,
      message: init.message,
      retryable: init.retryable,
    };
  }

  const db = openDatabase(init.dbPath);

  try {
    const matchedSymbols = resolveSymbolCandidates(db, selector, 10);
    if (matchedSymbols.length === 0) {
      return {
        ok: true,
        sourceSymbolName: symbolName,
        matchedSymbols: [],
        hits: [],
      };
    }

    const placeholders = matchedSymbols.map(() => "?").join(", ");
    const hits = db.prepare(
      `SELECT
         callee.name AS calleeSymbolName,
         callee.kind AS calleeKind,
         calleeParent.name AS calleeParentSymbolName,
         f.path AS filePath,
         callee.start_line AS startLine,
         callee.end_line AS endLine,
         r.relation_type AS relationType
       FROM relations r
       JOIN symbols callee ON callee.id = r.target_symbol_id
       LEFT JOIN symbols calleeParent ON calleeParent.id = callee.parent_symbol_id
       JOIN files f ON f.id = callee.file_id
       WHERE r.source_symbol_id IN (${placeholders})
       ORDER BY f.path ASC, callee.start_line ASC
       LIMIT ?`,
    ).all(
      ...matchedSymbols.map((row) => row.id),
      limit,
    ) as CalleeHit[];

    return {
      ok: true,
      sourceSymbolName: symbolName,
      matchedSymbols: matchedSymbols.map(toSymbolHit),
      hits: dedupeCallees(hits),
    };
  } finally {
    db.close();
  }
}

export function getRepositoryStatus(repoRoot: string): RepoStatus {
  const state = inspectRepositoryIndexState(repoRoot);

  if (!state.initialized) {
    return {
      ok: true,
      repoRoot,
      initialized: false,
      dbPath: state.dbPath,
      configPath: state.configPath,
      freshness: state.freshness,
      lastIndexedAt: state.lastIndexedAt,
      pendingChanges: state.pendingChanges,
      counts: {
        files: 0,
        symbols: 0,
        relations: 0,
        chunks: 0,
      },
    };
  }

  const db = openDatabase(state.dbPath);

  try {
    const count = (table: string): number =>
      Number(
        (
          db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          }
        ).count,
      );

    return {
      ok: true,
      repoRoot,
      initialized: true,
      dbPath: state.dbPath,
      configPath: state.configPath,
      freshness: state.freshness,
      lastIndexedAt: state.lastIndexedAt,
      pendingChanges: state.pendingChanges,
      counts: {
        files: count("files"),
        symbols: count("symbols"),
        relations: count("relations"),
        chunks: count("chunks"),
      },
    };
  } finally {
    db.close();
  }
}
