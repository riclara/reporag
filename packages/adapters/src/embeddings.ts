import type { ReporagConfig } from "@reporag/shared";
import { execFileSync } from "node:child_process";

export type EmbeddingProvider = {
  kind: "mock" | "openai";
  model: string;
  dimensions: number;
  embedTexts(texts: string[]): number[][];
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0) % dimensions;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function createMockEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);

  for (const token of tokenize(text)) {
    const index = hashToken(token, dimensions);
    vector[index] += 1;
  }

  return normalizeVector(vector);
}

function createMockProvider(config: ReporagConfig): EmbeddingProvider {
  const dimensions = Math.max(8, Math.min(config.embeddings.dimensions, 256));

  return {
    kind: "mock",
    model: config.embeddings.model,
    dimensions,
    embedTexts(texts: string[]): number[][] {
      return texts.map((text) => createMockEmbedding(text, dimensions));
    },
  };
}

function createOpenAiProvider(config: ReporagConfig): EmbeddingProvider | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return {
    kind: "openai",
    model: config.embeddings.model,
    dimensions: config.embeddings.dimensions,
    embedTexts(texts: string[]): number[][] {
      if (texts.length === 0) {
        return [];
      }

      const payload = JSON.parse(
        execFileSync(
          "curl",
          [
            "-sS",
            "https://api.openai.com/v1/embeddings",
            "-H",
            "content-type: application/json",
            "-H",
            `authorization: Bearer ${apiKey}`,
            "-d",
            JSON.stringify({
              input: texts,
              model: config.embeddings.model,
              dimensions: config.embeddings.dimensions,
            }),
          ],
          { encoding: "utf8" },
        ),
      ) as {
        data?: Array<{ embedding?: number[] }>;
      };

      return (payload.data ?? []).map((item) => item.embedding ?? []);
    },
  };
}

export function resolveEmbeddingProvider(
  config: ReporagConfig,
): EmbeddingProvider | null {
  if (!config.embeddings.enabled) {
    return null;
  }

  if (config.embeddings.provider === "mock") {
    return createMockProvider(config);
  }

  if (config.embeddings.provider === "openai") {
    return createOpenAiProvider(config);
  }

  return null;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const dimensions = Math.min(left.length, right.length);
  if (dimensions === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < dimensions; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
