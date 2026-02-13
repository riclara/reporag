import { z } from "zod";

export const queryInputSchema = z
  .object({
    repoRoot: z.string().min(1),
    intent: z.enum(["hybrid-search", "symbol-lookup", "find-callers"]),
    query: z.string().trim().min(2).max(500).optional(),
    symbolName: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(20).default(8),
    stalePolicy: z
      .enum(["fail", "warn", "auto-index-light"])
      .default("warn"),
  })
  .superRefine((value, ctx) => {
    if (value.intent === "hybrid-search" && !value.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "query is required for hybrid-search",
      });
    }

    if (
      (value.intent === "symbol-lookup" || value.intent === "find-callers") &&
      !value.symbolName
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbolName"],
        message: "symbolName is required for this intent",
      });
    }
  });
