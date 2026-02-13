const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  haste: {
    throwOnModuleCollision: false,
  },
  moduleNameMapper: {
    "^@reporag/shared$": "<rootDir>/packages/shared/dist/index.js",
    "^@reporag/adapters$": "<rootDir>/packages/adapters/dist/index.js",
    "^@reporag/domain$": "<rootDir>/packages/domain/dist/index.js",
    "^@reporag/app$": "<rootDir>/packages/app/dist/index.js",
    "^@reporag/cli$": "<rootDir>/packages/cli/dist/index.js",
    "^@reporag/mcp-server$": "<rootDir>/packages/mcp-server/dist/index.js",
  },
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    ...tsJestTransformCfg,
  },
};
