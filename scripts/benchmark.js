const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const {
  findCallees,
  findCallers,
  indexRepository,
  initRepository,
  lookupSymbol,
  queryRepository,
} = require("../packages/domain/dist");

const repoRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(repoRoot, "packages", "cli", "dist", "cli.js");

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function percentile(values, target) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((target / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function timeCall(fn) {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

function createFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-benchmark-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "reporag-benchmark-fixture", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "helper.ts"),
    "export function helper() { return 1; }\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "runner.ts"),
    [
      "export default class Runner {",
      "  run() {",
      "    return helper();",
      "  }",
      "}",
      "",
      "function helper() {",
      "  return 2;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "barrel.ts"),
    "export { helper as sharedHelper } from './helper';\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "flow.ts"),
    [
      "import { helper as loadHelper } from './helper';",
      "import MyRunner from './runner';",
      "import * as helperApi from './helper';",
      "import { sharedHelper as finalHelper } from './barrel';",
      "",
      "export function startPlayer() {",
      "  const localRunner = new MyRunner();",
      "  finalHelper();",
      "  helperApi.helper();",
      "  localRunner.run();",
      "  return loadHelper();",
      "}",
      "",
      "export class PlayerController {",
      "  helper() {",
      "    return loadHelper();",
      "  }",
      "",
      "  start() {",
      "    const classRunner = new MyRunner();",
      "    classRunner.run();",
      "    return this.helper();",
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  return root;
}

function evaluateFixtureSuite(root) {
  const cases = [
    {
      name: "symbol helper",
      run: () => lookupSymbol(root, "helper"),
      expect: (result) =>
        result.ok &&
        result.hits.some(
          (hit) => hit.filePath === "src/helper.ts" && hit.symbolName === "helper",
        ),
    },
    {
      name: "query exact symbol startPlayer",
      run: () => queryRepository(root, { query: "startPlayer", limit: 5 }),
      expect: (result) =>
        result.ok &&
        result.route === "symbol" &&
        result.hits[0] &&
        result.hits[0].symbolName === "startPlayer",
    },
    {
      name: "callers helper",
      run: () => findCallers(root, "helper", 10),
      expect: (result) =>
        result.ok &&
        ["startPlayer", "helper", "start"].every((name) =>
          result.hits.some((hit) => hit.callerSymbolName === name),
        ),
    },
    {
      name: "callers Runner",
      run: () => findCallers(root, "Runner", 10),
      expect: (result) =>
        result.ok &&
        ["startPlayer", "start"].every((name) =>
          result.hits.some((hit) => hit.callerSymbolName === name),
        ),
    },
    {
      name: "callees startPlayer",
      run: () => findCallees(root, "startPlayer", 10),
      expect: (result) =>
        result.ok &&
        ["sharedHelper", "helper", "Runner", "run"].every((name) =>
          result.hits.some((hit) => hit.calleeSymbolName === name),
        ),
    },
  ];

  const details = cases.map((testCase) => {
    const { result, durationMs } = timeCall(testCase.run);
    return {
      name: testCase.name,
      ok: testCase.expect(result),
      durationMs,
    };
  });

  return {
    passed: details.filter((item) => item.ok).length,
    total: details.length,
    details,
  };
}

function evaluateSelfSuite(root) {
  const cases = [
    {
      name: "query repository status",
      run: () => queryRepository(root, { query: "repository status", limit: 5 }),
      expect: (result) =>
        result.ok &&
        result.hits.some((hit) => hit.filePath === "packages/cli/src/cli.ts"),
    },
    {
      name: "query codex mcp config",
      run: () => queryRepository(root, { query: "codex mcp config", limit: 5 }),
      expect: (result) =>
        result.ok &&
        result.hits.some((hit) => hit.filePath === "packages/shared/src/mcp-config.ts"),
    },
    {
      name: "symbol runMcpServer",
      run: () => lookupSymbol(root, "runMcpServer", 5),
      expect: (result) =>
        result.ok &&
        result.hits.some(
          (hit) =>
            hit.filePath === "packages/app/src/mcp-server.ts" &&
            hit.symbolName === "runMcpServer",
        ),
    },
    {
      name: "symbol indexRepository",
      run: () => lookupSymbol(root, "indexRepository", 5),
      expect: (result) =>
        result.ok &&
        result.hits.some(
          (hit) =>
            hit.filePath === "packages/domain/src/indexer.ts" &&
            hit.symbolName === "indexRepository",
        ),
    },
    {
      name: "callees runMcpServer",
      run: () =>
        findCallees(root, "packages/app/src/mcp-server.ts#runMcpServer", 10),
      expect: (result) =>
        result.ok &&
        result.hits.some((hit) => hit.calleeSymbolName === "createMcpServer"),
    },
  ];

  const latencySamples = [];
  const details = [];

  for (const testCase of cases) {
    const runs = [];
    let finalResult = null;

    for (let index = 0; index < 5; index += 1) {
      const { result, durationMs } = timeCall(testCase.run);
      finalResult = result;
      runs.push(durationMs);
      latencySamples.push(durationMs);
    }

    details.push({
      name: testCase.name,
      ok: testCase.expect(finalResult),
      medianMs: median(runs),
      p95Ms: percentile(runs, 95),
    });
  }

  return {
    passed: details.filter((item) => item.ok).length,
    total: details.length,
    details,
    latency: {
      p50Ms: median(latencySamples),
      p95Ms: percentile(latencySamples, 95),
    },
  };
}

function main() {
  const benchmarkStartedAt = new Date().toISOString();

  const fixtureRoot = createFixtureRepo();
  try {
    initRepository(fixtureRoot, cliEntry);
    const fixtureIndex = timeCall(() => indexRepository(fixtureRoot));

    initRepository(repoRoot, cliEntry);
    const selfIndex = timeCall(() => indexRepository(repoRoot));

    const fixtureSuite = evaluateFixtureSuite(fixtureRoot);
    const selfSuite = evaluateSelfSuite(repoRoot);
    const hasFailures =
      fixtureSuite.passed !== fixtureSuite.total ||
      selfSuite.passed !== selfSuite.total;

    const summary = {
      benchmarkStartedAt,
      fixture: {
        repoRoot: fixtureRoot,
        indexMs: fixtureIndex.durationMs,
        indexResult: fixtureIndex.result,
        suite: fixtureSuite,
      },
      self: {
        repoRoot,
        indexMs: selfIndex.durationMs,
        indexResult: selfIndex.result,
        suite: selfSuite,
      },
    };

    const reportDir = path.join(repoRoot, ".reporag");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "benchmark-report.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    console.log("[benchmark] Fixture suite:", `${fixtureSuite.passed}/${fixtureSuite.total}`);
    for (const detail of fixtureSuite.details) {
      console.log(
        `  - ${detail.ok ? "PASS" : "FAIL"} ${detail.name} (${detail.durationMs.toFixed(2)} ms)`,
      );
    }

    console.log("[benchmark] Self suite:", `${selfSuite.passed}/${selfSuite.total}`);
    for (const detail of selfSuite.details) {
      console.log(
        `  - ${detail.ok ? "PASS" : "FAIL"} ${detail.name} median=${detail.medianMs.toFixed(2)} ms p95=${detail.p95Ms.toFixed(2)} ms`,
      );
    }

    console.log(
      `[benchmark] Self latency p50=${selfSuite.latency.p50Ms.toFixed(2)} ms p95=${selfSuite.latency.p95Ms.toFixed(2)} ms`,
    );
    console.log(
      `[benchmark] Index times fixture=${fixtureIndex.durationMs.toFixed(2)} ms self=${selfIndex.durationMs.toFixed(2)} ms`,
    );
    console.log(`[benchmark] Report written to ${reportPath}`);

    if (hasFailures) {
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

main();
