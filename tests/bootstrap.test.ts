import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { initRepository } from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-init-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true, workspaces: ["packages/*"] }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "packages", "demo", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "demo", "package.json"),
    JSON.stringify({ name: "@temp/demo", version: "1.0.0" }),
    "utf8",
  );
  return root;
}

describe("initRepository", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("detects the workspace root from a nested directory and writes broad defaults", () => {
    const nestedDir = path.join(tempRepo, "packages", "demo", "src");

    const result = initRepository(nestedDir);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const config = JSON.parse(fs.readFileSync(result.configPath, "utf8")) as {
      include: string[];
      exclude: string[];
    };

    expect(result.repoRoot).toBe(tempRepo);
    expect(config.include).toContain("**/*.ts");
    expect(config.include).toContain("**/*.js");
    expect(config.exclude).toContain("**/.reporag/**");
  });
});
