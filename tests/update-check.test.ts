import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  checkForUpdate,
  compareVersions,
  formatUpdateMessage,
  getUpdateCheckCachePath,
  shouldCheckForUpdates,
} from "../packages/cli/src/update-check";

describe("update check helpers", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  let tempHome: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-update-check-"));
    process.env.HOME = tempHome;
    delete process.env.XDG_CACHE_HOME;
    delete process.env.REPORAG_DISABLE_UPDATE_CHECK;
    delete process.env.CI;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("compares semver-like versions numerically", () => {
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("0.10.0", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.1")).toBe(-1);
  });

  it("skips update checks when disabled by environment", async () => {
    process.env.REPORAG_DISABLE_UPDATE_CHECK = "1";

    expect(shouldCheckForUpdates()).toBe(false);
    await expect(checkForUpdate("0.2.0")).resolves.toBeNull();
  });

  it("returns a newer version and writes a cache entry", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.3.0" }),
    })) as unknown as typeof fetch;

    const result = await checkForUpdate("0.2.0");
    const cachePath = getUpdateCheckCachePath();
    const cache = JSON.parse(
      fs.readFileSync(cachePath, "utf8"),
    ) as { latestVersion: string; checkedAt: number };

    expect(result).toEqual({
      currentVersion: "0.2.0",
      latestVersion: "0.3.0",
    });
    expect(cache.latestVersion).toBe("0.3.0");
    expect(typeof cache.checkedAt).toBe("number");
  });

  it("uses a fresh cache without hitting the network", async () => {
    const cachePath = getUpdateCheckCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: Date.now(),
        latestVersion: "0.4.0",
      }),
      "utf8",
    );

    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await checkForUpdate("0.2.0");

    expect(result).toEqual({
      currentVersion: "0.2.0",
      latestVersion: "0.4.0",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("formats the update message with install guidance", () => {
    expect(
      formatUpdateMessage({
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
      }),
    ).toContain("npm install -g reporag@latest");
  });
});
