export type IndexResult =
  | {
      ok: true;
      repoRoot: string;
      scanned: number;
      inserted: number;
      updated: number;
      removed: number;
      symbols: number;
      relations: number;
      chunks: number;
    }
  | {
      ok: false;
      repoRoot: string;
      errorCode: "REPO_NOT_INITIALIZED" | "FS_ERROR" | "DB_ERROR";
      message: string;
    };
