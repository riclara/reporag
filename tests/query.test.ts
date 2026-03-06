import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { initRepository, indexRepository, queryRepository } from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-query-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "packages", "demo", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "startup.ts"),
    [
      "export function helper() {",
      "  return 1;",
      "}",
      "",
      "export function startPlayer() {",
      "  return helper();",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "webhook-handler.ts"),
    [
      "export function handleWebhookMessage() {",
      "  return processMessagePayload();",
      "}",
      "",
      "function processMessagePayload() {",
      "  return true;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function enableMockEmbeddings(repoRoot: string): void {
  const configPath = path.join(repoRoot, ".reporag", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    embeddings: Record<string, unknown>;
  };

  config.embeddings = {
    ...config.embeddings,
    enabled: true,
    provider: "mock",
    model: "mock-embeddings",
    dimensions: 64,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

describe("queryRepository", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
    initRepository(tempRepo);
    indexRepository(tempRepo);
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("returns exact symbol matches before general lexical matches", () => {
    const result = queryRepository(tempRepo, { query: "helper" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.route).toBe("symbol");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].symbolName).toBe("helper");
  });

  it("uses FTS-backed lexical search for content queries", () => {
    const result = queryRepository(tempRepo, { query: "return helper" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.route).toBe("fts");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].filePath).toBe("packages/demo/src/startup.ts");
    expect(result.hits[0].rationale).toContain("fts lexical match");
  });

  it("upgrades lexical matches with embeddings when configured", () => {
    enableMockEmbeddings(tempRepo);
    indexRepository(tempRepo);

    const result = queryRepository(tempRepo, { query: "return helper" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.route).toBe("hybrid");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].rationale).toContain("embedding similarity");
  });

  it("improves natural-language style queries with structural expansion", () => {
    const result = queryRepository(tempRepo, {
      query: "webhook message handler",
      limit: 5,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].filePath).toBe("packages/demo/src/webhook-handler.ts");
  });

  it("honors stalePolicy for fail, warn and auto-index-light", () => {
    fs.writeFileSync(
      path.join(tempRepo, "packages", "demo", "src", "startup.ts"),
      [
        "export function helper() {",
        "  return 1;",
        "}",
        "",
        "export function startPlayer() {",
        "  return helper();",
        "}",
        "",
        "export function launchSequence() {",
        "  return startPlayer();",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const failResult = queryRepository(tempRepo, {
      query: "launchSequence",
      stalePolicy: "fail",
    });
    expect(failResult.ok).toBe(false);
    if (failResult.ok) {
      return;
    }

    expect(failResult.code).toBe("INDEX_STALE");

    const warnResult = queryRepository(tempRepo, {
      query: "launchSequence",
      stalePolicy: "warn",
    });
    expect(warnResult.ok).toBe(true);
    if (!warnResult.ok) {
      return;
    }

    expect(warnResult.stale).toBe(true);
    expect(warnResult.hits).toHaveLength(0);

    const autoRefreshResult = queryRepository(tempRepo, {
      query: "launchSequence",
      stalePolicy: "auto-index-light",
    });
    expect(autoRefreshResult.ok).toBe(true);
    if (!autoRefreshResult.ok) {
      return;
    }

    expect(autoRefreshResult.stale).toBe(false);
    expect(autoRefreshResult.route).toBe("symbol");
    expect(autoRefreshResult.hits[0]?.symbolName).toBe("launchSequence");
  });
});
