import { z } from "zod";

export const LEGACY_DEFAULT_INCLUDE = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "src/**/*.js",
  "src/**/*.jsx",
] as const;

export const DEFAULT_REPORAG_CONFIG = {
  projectRoot: ".",
  include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/coverage/**",
    "**/.reporag/**",
  ],
  languageParsers: {
    typescript: true,
    javascript: true,
  },
  chunking: {
    strategy: "symbol",
    maxLines: 120,
    maxTokens: 800,
  },
  embeddings: {
    enabled: false,
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  retrieval: {
    topK: 8,
    graphExpansionDepth: 1,
  },
  mcp: {
    transport: "stdio",
  },
  git: {
    installHooks: false,
    autoIndexOnQuery: true,
  },
} as const;

export const reporagConfigSchema = z.object({
  projectRoot: z.string(),
  include: z.array(z.string()).min(1),
  exclude: z.array(z.string()),
  languageParsers: z.object({
    typescript: z.boolean(),
    javascript: z.boolean(),
  }),
  chunking: z.object({
    strategy: z.literal("symbol"),
    maxLines: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
  }),
  embeddings: z.object({
    enabled: z.boolean(),
    provider: z.string().min(1),
    model: z.string().min(1),
    dimensions: z.number().int().positive(),
  }),
  retrieval: z.object({
    topK: z.number().int().positive(),
    graphExpansionDepth: z.number().int().min(0).max(3),
  }),
  mcp: z.object({
    transport: z.literal("stdio"),
  }),
  git: z.object({
    installHooks: z.boolean(),
    autoIndexOnQuery: z.boolean(),
  }),
});

export type ReporagConfig = z.infer<typeof reporagConfigSchema>;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeExcludePatterns(values: readonly string[]): string[] {
  const replacements = new Map<string, string>([
    ["node_modules/**", "**/node_modules/**"],
    ["dist/**", "**/dist/**"],
    ["build/**", "**/build/**"],
    [".git/**", "**/.git/**"],
    ["coverage/**", "**/coverage/**"],
    [".reporag/**", "**/.reporag/**"],
  ]);

  return values.map((value) => replacements.get(value) ?? value);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function parseReporagConfig(raw: unknown): ReporagConfig {
  const candidate =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<ReporagConfig>)
      : {};

  const merged = {
    ...DEFAULT_REPORAG_CONFIG,
    ...candidate,
    include: Array.isArray(candidate.include)
      ? [...candidate.include]
      : [...DEFAULT_REPORAG_CONFIG.include],
    exclude: unique([
      ...DEFAULT_REPORAG_CONFIG.exclude,
      ...(Array.isArray(candidate.exclude) ? candidate.exclude : []),
    ]),
    languageParsers: {
      ...DEFAULT_REPORAG_CONFIG.languageParsers,
      ...candidate.languageParsers,
    },
    chunking: {
      ...DEFAULT_REPORAG_CONFIG.chunking,
      ...candidate.chunking,
    },
    embeddings: {
      ...DEFAULT_REPORAG_CONFIG.embeddings,
      ...candidate.embeddings,
    },
    retrieval: {
      ...DEFAULT_REPORAG_CONFIG.retrieval,
      ...candidate.retrieval,
    },
    mcp: {
      ...DEFAULT_REPORAG_CONFIG.mcp,
      ...candidate.mcp,
    },
    git: {
      ...DEFAULT_REPORAG_CONFIG.git,
      ...candidate.git,
    },
  };

  const validated = reporagConfigSchema.parse(merged);

  if (arraysEqual(validated.include, LEGACY_DEFAULT_INCLUDE)) {
    validated.include = [...DEFAULT_REPORAG_CONFIG.include];
  }

  validated.exclude = unique(normalizeExcludePatterns([
    ...DEFAULT_REPORAG_CONFIG.exclude,
    ...validated.exclude,
  ]));

  return validated;
}
