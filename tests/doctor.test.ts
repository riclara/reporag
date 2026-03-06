import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import type { DoctorCheck } from "@reporag/shared";
import { initRepository, indexRepository, runDoctor } from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-doctor-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "main.ts"),
    "export function boot() { return true; }\n",
    "utf8",
  );
  return root;
}

describe("runDoctor", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("reports warnings before init and healthy state after indexing", () => {
    const beforeInit = runDoctor(tempRepo);
    expect(beforeInit.summary).toBe("warning");
    expect(
      beforeInit.checks.some(
        (check: DoctorCheck) => check.name === "config-present" && !check.ok,
      ),
    ).toBe(true);

    initRepository(tempRepo);
    indexRepository(tempRepo);

    const afterIndex = runDoctor(tempRepo);
    expect(afterIndex.summary).toBe("healthy");
    expect(
      afterIndex.checks.some(
        (check: DoctorCheck) => check.name === "index-content" && check.ok,
      ),
    ).toBe(true);
  });

  it("warns when the working tree makes the index stale", () => {
    initRepository(tempRepo);
    indexRepository(tempRepo);

    fs.writeFileSync(
      path.join(tempRepo, "src", "main.ts"),
      "export function boot() { return 'stale'; }\n",
      "utf8",
    );

    const doctor = runDoctor(tempRepo);
    expect(doctor.summary).toBe("warning");
    expect(
      doctor.checks.some(
        (check: DoctorCheck) => check.name === "index-fresh" && !check.ok,
      ),
    ).toBe(true);
  });
});
