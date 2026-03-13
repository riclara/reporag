import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const RELEASE_SYNC_ENTRY = path.join(process.cwd(), "scripts", "release-sync.mjs");

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-release-sync-"));

  writeJson(path.join(root, "package.json"), {
    name: "reporag",
    private: true,
    version: "0.1.0",
    workspaces: ["packages/*"],
  });

  writeJson(path.join(root, "packages", "shared", "package.json"), {
    name: "@reporag/shared",
    version: "0.1.0",
    private: true,
  });

  writeJson(path.join(root, "packages", "domain", "package.json"), {
    name: "@reporag/domain",
    version: "0.1.0",
    private: true,
    dependencies: {
      "@reporag/shared": "0.1.0",
    },
  });

  writeJson(path.join(root, "packages", "app", "package.json"), {
    name: "@reporag/app",
    version: "0.1.0",
    private: true,
    dependencies: {
      "@reporag/domain": "0.1.0",
      "@reporag/shared": "0.1.0",
    },
  });

  writeJson(path.join(root, "packages", "cli", "package.json"), {
    name: "reporag",
    version: "0.1.0",
    private: false,
  });

  fs.mkdirSync(path.join(root, "packages", "app", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "app", "src", "mcp-server.ts"),
    [
      'const MCP_SERVER_VERSION = "0.1.0"; // x-release-please-version',
      "",
      "export function getVersion(): string {",
      "  return MCP_SERVER_VERSION;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  writeJson(path.join(root, "package-lock.json"), {
    name: "reporag",
    version: "0.1.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "reporag",
        version: "0.1.0",
        workspaces: ["packages/*"],
      },
      "packages/shared": {
        name: "@reporag/shared",
        version: "0.1.0",
      },
      "packages/domain": {
        name: "@reporag/domain",
        version: "0.1.0",
        dependencies: {
          "@reporag/shared": "0.1.0",
        },
      },
      "packages/app": {
        name: "@reporag/app",
        version: "0.1.0",
        dependencies: {
          "@reporag/domain": "0.1.0",
          "@reporag/shared": "0.1.0",
        },
      },
      "packages/cli": {
        name: "reporag",
        version: "0.1.0",
      },
    },
  });

  return root;
}

function runReleaseSync(tempRepo: string, args: string[]) {
  return spawnSync("node", [RELEASE_SYNC_ENTRY, "--repo-root", tempRepo, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("release-sync", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("updates root and workspace versions, internal dependencies, lockfile metadata and MCP version", () => {
    const result = runReleaseSync(tempRepo, ["--version", "0.2.0"]);

    expect(result.status).toBe(0);

    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(tempRepo, "package.json"), "utf8"),
    ) as { version: string };
    const domainPackage = JSON.parse(
      fs.readFileSync(path.join(tempRepo, "packages", "domain", "package.json"), "utf8"),
    ) as {
      version: string;
      dependencies: Record<string, string>;
    };
    const appPackage = JSON.parse(
      fs.readFileSync(path.join(tempRepo, "packages", "app", "package.json"), "utf8"),
    ) as {
      version: string;
      dependencies: Record<string, string>;
    };
    const lockFile = JSON.parse(
      fs.readFileSync(path.join(tempRepo, "package-lock.json"), "utf8"),
    ) as {
      version: string;
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
    };
    const mcpSource = fs.readFileSync(
      path.join(tempRepo, "packages", "app", "src", "mcp-server.ts"),
      "utf8",
    );

    expect(rootPackage.version).toBe("0.2.0");
    expect(domainPackage.version).toBe("0.2.0");
    expect(domainPackage.dependencies["@reporag/shared"]).toBe("0.2.0");
    expect(appPackage.version).toBe("0.2.0");
    expect(appPackage.dependencies["@reporag/domain"]).toBe("0.2.0");
    expect(appPackage.dependencies["@reporag/shared"]).toBe("0.2.0");
    expect(lockFile.version).toBe("0.2.0");
    expect(lockFile.packages[""].version).toBe("0.2.0");
    expect(lockFile.packages["packages/app"].version).toBe("0.2.0");
    expect(lockFile.packages["packages/app"].dependencies?.["@reporag/domain"]).toBe("0.2.0");
    expect(lockFile.packages["packages/domain"].dependencies?.["@reporag/shared"]).toBe(
      "0.2.0",
    );
    expect(mcpSource).toContain('const MCP_SERVER_VERSION = "0.2.0";');
  });

  it("fails in check mode when any tracked version drifts", () => {
    fs.writeFileSync(
      path.join(tempRepo, "packages", "app", "src", "mcp-server.ts"),
      [
        'const MCP_SERVER_VERSION = "0.1.1"; // x-release-please-version',
        "",
        "export function getVersion(): string {",
        "  return MCP_SERVER_VERSION;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runReleaseSync(tempRepo, ["--check"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Version drift detected");
    expect(result.stderr).toContain("packages/app/src/mcp-server.ts");
  });
});
