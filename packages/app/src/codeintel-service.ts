import type {
  DoctorResult,
  FindCalleesResult,
  FindCallersResult,
  IndexResult,
  InitResult,
  QueryResult,
  RepoStatus,
  SymbolLookupResult,
} from "@reporag/shared";
import {
  findCallees,
  findCallers,
  getRepositoryStatus,
  initRepository,
  indexRepository,
  lookupSymbol,
  queryRepository,
  runDoctor,
} from "@reporag/domain";

export class CodeIntelService {
  static init(repoRoot: string, cliEntryPath?: string): InitResult {
    return initRepository(repoRoot, cliEntryPath);
  }

  static index(repoRoot: string): IndexResult {
    return indexRepository(repoRoot);
  }

  static query(
    repoRoot: string,
    query: string,
    limit?: number,
    stalePolicy: "fail" | "warn" | "auto-index-light" = "auto-index-light",
  ): QueryResult {
    return queryRepository(repoRoot, { query, limit, stalePolicy });
  }

  static symbol(
    repoRoot: string,
    symbolName: string,
    limit?: number,
  ): SymbolLookupResult {
    return lookupSymbol(repoRoot, symbolName, limit);
  }

  static callers(
    repoRoot: string,
    symbolName: string,
    limit?: number,
  ): FindCallersResult {
    return findCallers(repoRoot, symbolName, limit);
  }

  static callees(
    repoRoot: string,
    symbolName: string,
    limit?: number,
  ): FindCalleesResult {
    return findCallees(repoRoot, symbolName, limit);
  }

  static status(repoRoot: string): RepoStatus {
    return getRepositoryStatus(repoRoot);
  }

  static doctor(repoRoot: string): DoctorResult {
    return runDoctor(repoRoot);
  }
}
