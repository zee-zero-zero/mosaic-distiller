// Provides the file walking the repository checks share: the repository root, every file under a
// directory with an extension filter, skipping dependencies, build output and the MosAIc clone.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SKIP = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".mosaic",
  "test-results",
  "playwright-report",
]);

export function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

export function rel(path: string): string {
  return relative(ROOT, path);
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}
