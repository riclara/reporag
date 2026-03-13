import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "@jest/globals";

describe("CLI version output", () => {
  it("prints the published package version for --version", () => {
    const repoRoot = process.cwd();
    const cliEntry = path.join(repoRoot, "packages", "cli", "dist", "cli.js");
    const packageJsonPath = path.join(
      repoRoot,
      "packages",
      "cli",
      "package.json",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    ) as { version: string };

    const output = execFileSync(process.execPath, [cliEntry, "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(output.trim()).toBe(packageJson.version);
  });
});
