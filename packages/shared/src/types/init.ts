export type InitResult =
  | {
      ok: true;
      repoRoot: string;
      configPath: string;
      dbPath: string;
      alreadyInitialized: boolean;
    }
  | {
      ok: false;
      repoRoot: string;
      errorCode: "OUTSIDE_REPO" | "FS_ERROR" | "DB_ERROR";
      message: string;
    };

