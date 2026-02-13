export type SymbolHit = {
  filePath: string;
  symbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  parentSymbolName?: string;
};

export type RepoFreshness = "fresh" | "stale";

export type PendingIndexChanges = {
  added: number;
  changed: number;
  removed: number;
};

export type SymbolLookupResult =
  | {
      ok: true;
      hits: SymbolHit[];
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "REPO_NOT_INITIALIZED" | "INDEX_REFRESH_FAILED";
      message: string;
      retryable: boolean;
    };

export type CallerHit = {
  callerSymbolName: string;
  callerKind: string;
  callerParentSymbolName?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  relationType: "calls";
};

export type CalleeHit = {
  calleeSymbolName: string;
  calleeKind: string;
  calleeParentSymbolName?: string;
  filePath: string;
  startLine: number;
  endLine: number;
  relationType: "calls";
};

export type FindCallersResult =
  | {
      ok: true;
      targetSymbolName: string;
      matchedSymbols: SymbolHit[];
      hits: CallerHit[];
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "REPO_NOT_INITIALIZED" | "INDEX_REFRESH_FAILED";
      message: string;
      retryable: boolean;
    };

export type FindCalleesResult =
  | {
      ok: true;
      sourceSymbolName: string;
      matchedSymbols: SymbolHit[];
      hits: CalleeHit[];
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "REPO_NOT_INITIALIZED" | "INDEX_REFRESH_FAILED";
      message: string;
      retryable: boolean;
    };

export type RepoStatus = {
  ok: true;
  repoRoot: string;
  initialized: boolean;
  dbPath: string;
  configPath: string;
  freshness: RepoFreshness;
  lastIndexedAt?: string;
  pendingChanges: PendingIndexChanges;
  counts: {
    files: number;
    symbols: number;
    relations: number;
    chunks: number;
  };
};
