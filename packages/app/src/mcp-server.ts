import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CodeIntelService } from "./codeintel-service";

const MCP_SERVER_VERSION = "0.5.0"; // x-release-please-version

function formatTextBlock(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function formatSearchText(
  route: string,
  hits: Array<{
    filePath: string;
    symbolName?: string;
    startLine: number;
    endLine: number;
    score: number;
    rationale: string;
  }>,
): string {
  if (hits.length === 0) {
    return `route=${route}\nNo matches found.`;
  }

  const lines = [`route=${route}`];
  for (const [index, hit] of hits.entries()) {
    lines.push(
      `${index + 1}. ${hit.filePath}:${hit.startLine}-${hit.endLine} score=${hit.score}`,
    );
    if (hit.symbolName) {
      lines.push(`   symbol: ${hit.symbolName}`);
    }
    lines.push(`   why: ${hit.rationale}`);
  }
  return lines.join("\n");
}

function createMcpServer(repoRoot: string): McpServer {
  const server = new McpServer({
    name: "reporag",
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "search_code",
    {
      description: "Search indexed code snippets in the current repository.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, limit }) => {
      const result = CodeIntelService.query(repoRoot, query, limit ?? 8);
      if (!result.ok) {
        throw new Error(result.message);
      }

      return {
        content: formatTextBlock(formatSearchText(result.route, result.hits)),
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_symbol",
    {
      description: "Find exact or approximate symbols in the current repository.",
      inputSchema: {
        symbolName: z.string().min(1),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ symbolName, limit }) => {
      const result = CodeIntelService.symbol(repoRoot, symbolName, limit ?? 10);
      if (!result.ok) {
        throw new Error(result.message);
      }

      const text =
        result.hits.length === 0
          ? "No symbol matches found."
          : result.hits
              .map(
                (hit, index) =>
                  `${index + 1}. ${hit.symbolName} (${hit.kind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`,
              )
              .join("\n");

      return {
        content: formatTextBlock(text),
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "find_callers",
    {
      description: "Find callers of a symbol in the current repository.",
      inputSchema: {
        symbolName: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ symbolName, limit }) => {
      const result = CodeIntelService.callers(repoRoot, symbolName, limit ?? 20);
      if (!result.ok) {
        throw new Error(result.message);
      }

      const text =
        result.hits.length === 0
          ? `No callers found for ${result.targetSymbolName}.`
          : [
              ...(result.matchedSymbols.length > 1
                ? [
                    `Matched ${result.matchedSymbols.length} symbols for ${result.targetSymbolName}:`,
                    ...result.matchedSymbols.map(
                      (match, index) =>
                        `  ${index + 1}. ${match.parentSymbolName ? `${match.parentSymbolName}.` : ""}${match.symbolName} ${match.filePath}:${match.startLine}-${match.endLine}`,
                    ),
                    "",
                  ]
                : []),
              ...result.hits.map(
                (hit, index) =>
                  `${index + 1}. ${hit.callerParentSymbolName ? `${hit.callerParentSymbolName}.` : ""}${hit.callerSymbolName} (${hit.callerKind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`,
              ),
            ].join("\n");

      return {
        content: formatTextBlock(text),
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "find_callees",
    {
      description: "Find callees of a symbol in the current repository.",
      inputSchema: {
        symbolName: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ symbolName, limit }) => {
      const result = CodeIntelService.callees(repoRoot, symbolName, limit ?? 20);
      if (!result.ok) {
        throw new Error(result.message);
      }

      const text =
        result.hits.length === 0
          ? `No callees found for ${result.sourceSymbolName}.`
          : [
              ...(result.matchedSymbols.length > 1
                ? [
                    `Matched ${result.matchedSymbols.length} symbols for ${result.sourceSymbolName}:`,
                    ...result.matchedSymbols.map(
                      (match, index) =>
                        `  ${index + 1}. ${match.parentSymbolName ? `${match.parentSymbolName}.` : ""}${match.symbolName} ${match.filePath}:${match.startLine}-${match.endLine}`,
                    ),
                    "",
                  ]
                : []),
              ...result.hits.map(
                (hit, index) =>
                  `${index + 1}. ${hit.calleeParentSymbolName ? `${hit.calleeParentSymbolName}.` : ""}${hit.calleeSymbolName} (${hit.calleeKind}) ${hit.filePath}:${hit.startLine}-${hit.endLine}`,
              ),
            ].join("\n");

      return {
        content: formatTextBlock(text),
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function runMcpServer(repoRoot: string): Promise<void> {
  const server = createMcpServer(repoRoot);
  const transport = new StdioServerTransport();

  const shutdown = async (): Promise<void> => {
    await server.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  await server.connect(transport);
  // Codex/Claude logs this line, which helps confirm readiness.
  // eslint-disable-next-line no-console
  console.error(`Repository intelligence MCP server running on stdio for ${repoRoot}`);
}

export { createMcpServer };
