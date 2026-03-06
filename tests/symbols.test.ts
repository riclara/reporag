import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  findCallees,
  findCallers,
  getRepositoryStatus,
  initRepository,
  indexRepository,
  lookupSymbol,
} from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-symbols-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "packages", "demo", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "helper.ts"),
    [
      "export function helper() {",
      "  return 1;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "runner.ts"),
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
    path.join(root, "packages", "demo", "src", "barrel.ts"),
    [
      "export { helper as sharedHelper } from './helper';",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "flow.ts"),
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
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "execute-usecases.ts"),
    [
      "export class HandleWebContact {",
      "  async execute() {",
      "    return 'web';",
      "  }",
      "}",
      "",
      "export class HandleIncomingWhatsAppMessage {",
      "  async execute() {",
      "    return 'wa';",
      "  }",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "packages", "demo", "src", "execute-routers.ts"),
    [
      "import { HandleIncomingWhatsAppMessage, HandleWebContact } from './execute-usecases';",
      "",
      "interface RouterDeps {",
      "  handleWebContact: HandleWebContact;",
      "  handleMessage: HandleIncomingWhatsAppMessage;",
      "}",
      "",
      "export async function contactRouter(deps: RouterDeps) {",
      "  return deps.handleWebContact.execute();",
      "}",
      "",
      "export async function whatsappWebhookRouter(deps: RouterDeps) {",
      "  return deps.handleMessage.execute();",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("symbol navigation", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = createTempRepo();
    initRepository(tempRepo);
    indexRepository(tempRepo);
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("finds symbols, callers and callees from the same index", () => {
    const symbolResult = lookupSymbol(tempRepo, "helper");
    expect(symbolResult.ok).toBe(true);
    if (!symbolResult.ok) {
      return;
    }

    expect(symbolResult.hits.length).toBeGreaterThan(0);
    expect(symbolResult.hits[0].symbolName).toBe("helper");

    const callersResult = findCallers(tempRepo, "helper");
    expect(callersResult.ok).toBe(true);
    if (!callersResult.ok) {
      return;
    }

    expect(callersResult.hits.length).toBeGreaterThan(0);
    expect(callersResult.hits.map((hit) => hit.callerSymbolName)).toEqual(
      expect.arrayContaining(["startPlayer", "helper", "start"]),
    );

    const runnerCallers = findCallers(tempRepo, "Runner");
    expect(runnerCallers.ok).toBe(true);
    if (!runnerCallers.ok) {
      return;
    }

    expect(runnerCallers.hits.map((hit) => hit.callerSymbolName)).toEqual(
      expect.arrayContaining(["startPlayer", "start"]),
    );

    const sharedHelperSymbol = lookupSymbol(tempRepo, "sharedHelper");
    expect(sharedHelperSymbol.ok).toBe(true);
    if (!sharedHelperSymbol.ok) {
      return;
    }

    expect(sharedHelperSymbol.hits.map((hit) => hit.symbolName)).toContain(
      "sharedHelper",
    );

    const finalHelperCallers = findCallers(tempRepo, "helper");
    expect(finalHelperCallers.ok).toBe(true);
    if (!finalHelperCallers.ok) {
      return;
    }

    expect(finalHelperCallers.hits.map((hit) => hit.callerSymbolName)).toEqual(
      expect.arrayContaining(["startPlayer", "helper", "start"]),
    );

    const calleesResult = findCallees(tempRepo, "startPlayer");
    expect(calleesResult.ok).toBe(true);
    if (!calleesResult.ok) {
      return;
    }

    expect(calleesResult.hits.length).toBeGreaterThan(0);
    expect(calleesResult.hits.map((hit) => hit.calleeSymbolName)).toEqual(
      expect.arrayContaining(["helper", "Runner", "sharedHelper"]),
    );

    const methodCallersResult = findCallers(tempRepo, "helper");
    expect(methodCallersResult.ok).toBe(true);
    if (!methodCallersResult.ok) {
      return;
    }

    expect(methodCallersResult.hits.map((hit) => hit.callerSymbolName)).toEqual(
      expect.arrayContaining(["startPlayer", "helper"]),
    );

    const startCalleesResult = findCallees(tempRepo, "start");
    expect(startCalleesResult.ok).toBe(true);
    if (!startCalleesResult.ok) {
      return;
    }

    expect(startCalleesResult.hits.map((hit) => hit.calleeSymbolName)).toContain(
      "helper",
    );
  });

  it("disambiguates generic method names with parent and path selectors", () => {
    const genericHelperCallers = findCallers(tempRepo, "helper");
    expect(genericHelperCallers.ok).toBe(true);
    if (!genericHelperCallers.ok) {
      return;
    }

    expect(genericHelperCallers.matchedSymbols.length).toBeGreaterThan(1);

    const controllerHelperCallers = findCallers(
      tempRepo,
      "PlayerController.helper",
    );
    expect(controllerHelperCallers.ok).toBe(true);
    if (!controllerHelperCallers.ok) {
      return;
    }

    expect(controllerHelperCallers.matchedSymbols).toHaveLength(1);
    expect(controllerHelperCallers.matchedSymbols[0].parentSymbolName).toBe(
      "PlayerController",
    );
    expect(controllerHelperCallers.hits.map((hit) => hit.callerSymbolName)).toContain(
      "start",
    );

    const fileScopedHelper = lookupSymbol(
      tempRepo,
      "packages/demo/src/flow.ts#helper",
    );
    expect(fileScopedHelper.ok).toBe(true);
    if (!fileScopedHelper.ok) {
      return;
    }

    expect(fileScopedHelper.hits).toHaveLength(1);
    expect(fileScopedHelper.hits[0].parentSymbolName).toBe("PlayerController");

    const fullyScopedHelper = lookupSymbol(
      tempRepo,
      "packages/demo/src/flow.ts#PlayerController.helper",
    );
    expect(fullyScopedHelper.ok).toBe(true);
    if (!fullyScopedHelper.ok) {
      return;
    }

    expect(fullyScopedHelper.hits).toHaveLength(1);
    expect(fullyScopedHelper.hits[0].parentSymbolName).toBe("PlayerController");

    const controllerStartCallees = findCallees(tempRepo, "PlayerController.start");
    expect(controllerStartCallees.ok).toBe(true);
    if (!controllerStartCallees.ok) {
      return;
    }

    expect(controllerStartCallees.matchedSymbols).toHaveLength(1);
    expect(
      controllerStartCallees.hits.map(
        (hit) =>
          `${hit.calleeParentSymbolName ? `${hit.calleeParentSymbolName}.` : ""}${hit.calleeSymbolName}`,
      ),
    ).toEqual(expect.arrayContaining(["PlayerController.helper", "Runner"]));
  });

  it("resolves property-access method calls to the correct class-scoped target", () => {
    const handleMessageCallers = findCallers(
      tempRepo,
      "HandleIncomingWhatsAppMessage.execute",
    );
    expect(handleMessageCallers.ok).toBe(true);
    if (!handleMessageCallers.ok) {
      return;
    }

    expect(handleMessageCallers.matchedSymbols).toHaveLength(1);
    expect(
      handleMessageCallers.hits.map((hit) => hit.callerSymbolName),
    ).toContain("whatsappWebhookRouter");
    expect(
      handleMessageCallers.hits.map((hit) => hit.callerSymbolName),
    ).not.toContain("contactRouter");

    const fullyScopedHandleMessageCallers = findCallers(
      tempRepo,
      "packages/demo/src/execute-usecases.ts#HandleIncomingWhatsAppMessage.execute",
    );
    expect(fullyScopedHandleMessageCallers.ok).toBe(true);
    if (!fullyScopedHandleMessageCallers.ok) {
      return;
    }

    expect(fullyScopedHandleMessageCallers.matchedSymbols).toHaveLength(1);
    expect(
      fullyScopedHandleMessageCallers.hits.map((hit) => hit.callerSymbolName),
    ).toContain("whatsappWebhookRouter");

    const handleWebContactCallers = findCallers(
      tempRepo,
      "HandleWebContact.execute",
    );
    expect(handleWebContactCallers.ok).toBe(true);
    if (!handleWebContactCallers.ok) {
      return;
    }

    expect(handleWebContactCallers.matchedSymbols).toHaveLength(1);
    expect(
      handleWebContactCallers.hits.map((hit) => hit.callerSymbolName),
    ).toContain("contactRouter");
    expect(
      handleWebContactCallers.hits.map((hit) => hit.callerSymbolName),
    ).not.toContain("whatsappWebhookRouter");
  });

  it("reports repository status from the persisted index", () => {
    const status = getRepositoryStatus(tempRepo);

    expect(status.initialized).toBe(true);
    expect(status.freshness).toBe("fresh");
    expect(status.lastIndexedAt).toBeDefined();
    expect(status.pendingChanges).toEqual({
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(status.counts.files).toBe(6);
    expect(status.counts.symbols).toBeGreaterThanOrEqual(11);
    expect(status.counts.relations).toBeGreaterThanOrEqual(6);
    expect(status.counts.chunks).toBeGreaterThanOrEqual(11);
  });

  it("auto-refreshes symbol, callers and callees against stale working tree changes", () => {
    fs.writeFileSync(
      path.join(tempRepo, "packages", "demo", "src", "flow.ts"),
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
        "export function refreshPlayer() {",
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

    const staleStatus = getRepositoryStatus(tempRepo);
    expect(staleStatus.freshness).toBe("stale");
    expect(staleStatus.pendingChanges.changed).toBe(1);

    const symbolResult = lookupSymbol(tempRepo, "refreshPlayer");
    expect(symbolResult.ok).toBe(true);
    if (!symbolResult.ok) {
      return;
    }

    expect(symbolResult.hits.map((hit) => hit.symbolName)).toContain("refreshPlayer");

    const callersResult = findCallers(tempRepo, "helper");
    expect(callersResult.ok).toBe(true);
    if (!callersResult.ok) {
      return;
    }

    expect(callersResult.hits.map((hit) => hit.callerSymbolName)).toContain(
      "refreshPlayer",
    );

    const calleesResult = findCallees(tempRepo, "refreshPlayer");
    expect(calleesResult.ok).toBe(true);
    if (!calleesResult.ok) {
      return;
    }

    expect(calleesResult.hits.map((hit) => hit.calleeSymbolName)).toContain(
      "helper",
    );

    const freshStatus = getRepositoryStatus(tempRepo);
    expect(freshStatus.freshness).toBe("fresh");
    expect(freshStatus.pendingChanges).toEqual({
      added: 0,
      changed: 0,
      removed: 0,
    });
  });
});
