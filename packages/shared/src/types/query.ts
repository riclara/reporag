export type QueryIntent = "hybrid-search" | "symbol-lookup" | "find-callers";

export type QueryInput = {
  repoRoot: string;
  intent: QueryIntent;
  query?: string;
  symbolName?: string;
  limit?: number;
  stalePolicy?: "fail" | "warn" | "auto-index-light";
};

export type QueryHit = {
  filePath: string;
  symbolName?: string;
  startLine: number;
  endLine: number;
  score: number;
  rationale: string;
};

export type QueryResult =
  | {
      ok: true;
      route: "symbol" | "fts" | "hybrid";
      stale: boolean;
      hits: QueryHit[];
    }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "REPO_NOT_INITIALIZED"
        | "INDEX_STALE"
        | "INDEX_REFRESH_FAILED"
        | "UNSUPPORTED_LANGUAGE"
        | "EMBEDDINGS_UNAVAILABLE";
      message: string;
      retryable: boolean;
    };
