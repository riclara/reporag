#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const INTERNAL_PACKAGE_PREFIX = "@reporag/";
const PACKAGE_JSON_NAME = "package.json";
const VERSION_MARKER =
  /const MCP_SERVER_VERSION = "([^"]+)"; \/\/ x-release-please-version/u;
const VERSION_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function parseArgs(argv) {
  const args = {
    check: false,
    repoRoot: process.cwd(),
    version: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--check") {
      args.check = true;
      continue;
    }

    if (arg === "--repo-root") {
      index += 1;
      args.repoRoot = argv[index];
      continue;
    }

    if (arg === "--version") {
      index += 1;
      args.version = argv[index];
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  if (!args.repoRoot) {
    throw new Error("Missing value for --repo-root");
  }

  if (args.version === "") {
    throw new Error("Missing value for --version");
  }

  return args;
}

function assertSemver(version) {
  const semverPattern =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

  if (!semverPattern.test(version)) {
    throw new Error(`Expected a semver version, received ${JSON.stringify(version)}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getWorkspacePackagePaths(repoRoot) {
  const packagesRoot = path.join(repoRoot, "packages");

  if (!fs.existsSync(packagesRoot)) {
    return [];
  }

  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name, PACKAGE_JSON_NAME))
    .filter((candidate) => fs.existsSync(candidate))
    .sort();
}

function updateInternalDependencyVersions(packageJson, internalNames, version) {
  let changed = false;

  for (const sectionName of VERSION_SECTIONS) {
    const section = packageJson[sectionName];
    if (!section || typeof section !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(section)) {
      if (!internalNames.has(dependencyName)) {
        continue;
      }

      if (section[dependencyName] === version) {
        continue;
      }

      section[dependencyName] = version;
      changed = true;
    }
  }

  return changed;
}

function syncPackageJson(packageJson, internalNames, version) {
  let changed = false;

  if (packageJson.version !== version) {
    packageJson.version = version;
    changed = true;
  }

  return updateInternalDependencyVersions(packageJson, internalNames, version) || changed;
}

function syncPackageLock(lockFile, workspacePackages, internalNames, version) {
  let changed = false;
  const packagesSection =
    lockFile.packages && typeof lockFile.packages === "object"
      ? lockFile.packages
      : null;

  if (lockFile.version !== version) {
    lockFile.version = version;
    changed = true;
  }

  if (packagesSection?.[""] && packagesSection[""].version !== version) {
    packagesSection[""].version = version;
    changed = true;
  }

  for (const workspacePackage of workspacePackages) {
    const lockEntry = packagesSection?.[workspacePackage.relativeDir];
    if (!lockEntry || typeof lockEntry !== "object") {
      continue;
    }

    if (lockEntry.version !== version) {
      lockEntry.version = version;
      changed = true;
    }

    const dependencies = lockEntry.dependencies;
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (!internalNames.has(dependencyName)) {
        continue;
      }

      if (dependencies[dependencyName] === version) {
        continue;
      }

      dependencies[dependencyName] = version;
      changed = true;
    }
  }

  return changed;
}

function syncMcpServerSource(source, version) {
  if (!VERSION_MARKER.test(source)) {
    throw new Error(
      "packages/app/src/mcp-server.ts is missing the x-release-please-version marker",
    );
  }

  return source.replace(
    VERSION_MARKER,
    `const MCP_SERVER_VERSION = "${version}"; // x-release-please-version`,
  );
}

function updateJsonFile(filePath, applyUpdate, changedFiles, checkOnly) {
  const current = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(current);
  const changed = applyUpdate(parsed);
  const next = `${JSON.stringify(parsed, null, 2)}\n`;

  if (!changed || current === next) {
    return;
  }

  changedFiles.push(filePath);

  if (!checkOnly) {
    writeJson(filePath, parsed);
  }
}

function updateTextFile(filePath, applyUpdate, changedFiles, checkOnly) {
  const current = fs.readFileSync(filePath, "utf8");
  const next = applyUpdate(current);

  if (current === next) {
    return;
  }

  changedFiles.push(filePath);

  if (!checkOnly) {
    fs.writeFileSync(filePath, next, "utf8");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot);
  const rootPackagePath = path.join(repoRoot, PACKAGE_JSON_NAME);
  const rootPackage = readJson(rootPackagePath);
  const version = args.version ?? rootPackage.version;
  const workspacePackagePaths = getWorkspacePackagePaths(repoRoot);
  const workspacePackages = workspacePackagePaths.map((packageJsonPath) => {
    const packageJson = readJson(packageJsonPath);
    return {
      name: packageJson.name,
      packageJsonPath,
      relativeDir: path.relative(repoRoot, path.dirname(packageJsonPath)),
    };
  });
  const internalNames = new Set(
    workspacePackages
      .map((workspacePackage) => workspacePackage.name)
      .filter(
        (workspacePackageName) =>
          typeof workspacePackageName === "string" &&
          workspacePackageName.startsWith(INTERNAL_PACKAGE_PREFIX),
      ),
  );
  const changedFiles = [];

  assertSemver(version);

  updateJsonFile(
    rootPackagePath,
    (packageJson) => syncPackageJson(packageJson, internalNames, version),
    changedFiles,
    args.check,
  );

  for (const workspacePackage of workspacePackages) {
    updateJsonFile(
      workspacePackage.packageJsonPath,
      (packageJson) => syncPackageJson(packageJson, internalNames, version),
      changedFiles,
      args.check,
    );
  }

  const packageLockPath = path.join(repoRoot, "package-lock.json");
  if (fs.existsSync(packageLockPath)) {
    updateJsonFile(
      packageLockPath,
      (lockFile) => syncPackageLock(lockFile, workspacePackages, internalNames, version),
      changedFiles,
      args.check,
    );
  }

  updateTextFile(
    path.join(repoRoot, "packages", "app", "src", "mcp-server.ts"),
    (source) => syncMcpServerSource(source, version),
    changedFiles,
    args.check,
  );

  if (args.check) {
    if (changedFiles.length > 0) {
      const relativePaths = changedFiles.map((filePath) => path.relative(repoRoot, filePath));
      console.error("[release-sync] Version drift detected:");
      for (const relativePath of relativePaths) {
        console.error(`- ${relativePath}`);
      }
      process.exit(1);
    }

    console.log(`[release-sync] OK: versions are synchronized at ${version}`);
    return;
  }

  if (changedFiles.length === 0) {
    console.log(`[release-sync] Already synchronized at ${version}`);
    return;
  }

  console.log(`[release-sync] Synchronized ${changedFiles.length} files to ${version}`);
}

try {
  main();
} catch (error) {
  console.error(
    `[release-sync] ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exit(1);
}
