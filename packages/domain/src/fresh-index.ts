import { indexRepository } from "./indexer";
import { inspectRepositoryIndexState } from "./repository-state";

type FreshIndexPolicy = "fail" | "warn" | "auto-index-light";

export type EnsureFreshIndexResult =
  | {
      ok: true;
      dbPath: string;
      stale: boolean;
    }
  | {
      ok: false;
      code: "REPO_NOT_INITIALIZED" | "INDEX_STALE";
      message: string;
      retryable: boolean;
      reason: "not-initialized" | "stale" | "refresh-failed";
    };

export function ensureFreshIndex(
  repoRoot: string,
  policy: FreshIndexPolicy,
): EnsureFreshIndexResult {
  const state = inspectRepositoryIndexState(repoRoot);

  if (!state.initialized) {
    return {
      ok: false,
      code: "REPO_NOT_INITIALIZED",
      message: "Repository not initialized. Run `reporag init` first.",
      retryable: false,
      reason: "not-initialized",
    };
  }

  if (state.freshness === "fresh") {
    return {
      ok: true,
      dbPath: state.dbPath,
      stale: false,
    };
  }

  if (policy === "warn") {
    return {
      ok: true,
      dbPath: state.dbPath,
      stale: true,
    };
  }

  if (policy === "fail") {
    return {
      ok: false,
      code: "INDEX_STALE",
      message:
        "Index is stale. Run `reporag index` or retry with `stalePolicy=auto-index-light`.",
      retryable: true,
      reason: "stale",
    };
  }

  const refresh = indexRepository(repoRoot);
  if (!refresh.ok) {
    return {
      ok: false,
      code: "INDEX_STALE",
      message: `Index refresh failed: ${refresh.message}`,
      retryable: true,
      reason: "refresh-failed",
    };
  }

  return {
    ok: true,
    dbPath: state.dbPath,
    stale: false,
  };
}
