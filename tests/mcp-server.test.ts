import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { initRepository, indexRepository } from "@reporag/domain";

function createTempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reporag-mcp-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "temp-reporag", private: true }),
    "utf8",
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    [
      "export function helper() {",
      "  return true;",
      "}",
      "",
      "export function run() {",
      "  return helper();",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("mcp server", () => {
  let tempRepo: string;
  const cliEntry = path.join(process.cwd(), "packages", "cli", "dist", "cli.js");

  beforeEach(() => {
    tempRepo = createTempRepo();
    initRepository(tempRepo, cliEntry);
    indexRepository(tempRepo);
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  });

  it("lists tools and resolves callees over stdio using the MCP SDK client", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliEntry, "mcp", "serve"],
      cwd: tempRepo,
      stderr: "pipe",
    });
    const client = new Client(
      {
        name: "reporag-test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          "search_code",
          "get_symbol",
          "find_callers",
          "find_callees",
        ]),
      );

      const callees = await client.callTool({
        name: "find_callees",
        arguments: {
          symbolName: "run",
        },
      });

      expect(callees).toHaveProperty("structuredContent.hits.0.calleeSymbolName", "helper");
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
