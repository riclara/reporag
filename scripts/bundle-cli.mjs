import fs from "node:fs";
import path from "node:path";

import { build } from "esbuild";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const entryPoint = path.join(repoRoot, "packages", "cli", "dist", "cli.js");
const outdir = path.join(repoRoot, "packages", "cli", "bundle");
const outfile = path.join(outdir, "reporag.cjs");

fs.mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["better-sqlite3", "typescript"],
});

const bundledSource = fs.readFileSync(outfile, "utf8");
const normalizedSource = bundledSource.replace(
  /^(#!\/usr\/bin\/env node\r?\n){2,}/u,
  "#!/usr/bin/env node\n",
);
if (normalizedSource !== bundledSource) {
  fs.writeFileSync(outfile, normalizedSource, "utf8");
}

fs.chmodSync(outfile, 0o755);

console.log(`[bundle] wrote ${outfile}`);
