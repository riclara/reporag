import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 500;
const PACKAGE_NAME = "reporag";

type UpdateCheckCache = {
  checkedAt: number;
  latestVersion: string;
};

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
};

export function getUpdateCheckCachePath(): string {
  const cacheRoot =
    process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache");

  return path.join(cacheRoot, "reporag", "update-check.json");
}

export function shouldCheckForUpdates(): boolean {
  if (process.env.REPORAG_DISABLE_UPDATE_CHECK === "1") {
    return false;
  }

  if (process.env.CI === "true") {
    return false;
  }

  return true;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^[^0-9]*/u, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function readCache(cachePath: string, now: number): UpdateCheckCache | null {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8")) as UpdateCheckCache;
    if (!Number.isFinite(cache.checkedAt) || typeof cache.latestVersion !== "string") {
      return null;
    }

    if (now - cache.checkedAt > UPDATE_CHECK_TTL_MS) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, latestVersion: string, now: number): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ checkedAt: now, latestVersion }, null, 2),
      "utf8",
    );
  } catch {
    // Ignore cache write failures. Update checks must stay best-effort.
  }
}

async function fetchLatestVersion(timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { version?: string };
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult | null> {
  if (!shouldCheckForUpdates()) {
    return null;
  }

  const now = Date.now();
  const cachePath = getUpdateCheckCachePath();
  const cached = readCache(cachePath, now);
  const latestVersion =
    cached?.latestVersion ?? (await fetchLatestVersion(UPDATE_CHECK_TIMEOUT_MS));

  if (!latestVersion) {
    return null;
  }

  if (!cached || cached.latestVersion !== latestVersion) {
    writeCache(cachePath, latestVersion, now);
  }

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return null;
  }

  return { currentVersion, latestVersion };
}

export function formatUpdateMessage(result: UpdateCheckResult): string {
  return [
    `[reporag] A new version is available: ${result.latestVersion} (current: ${result.currentVersion})`,
    "[reporag] Update with: npm install -g reporag@latest",
  ].join("\n");
}
