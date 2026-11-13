// Builds MosAIc Companion at the pinned commit for the end-to-end rig (§5.8, step 3.1).
// It clones the repository into `rigs/e2e/.mosaic/<commit>/`, checks out the commit, runs `npm ci`
// and MosAIc's own build of the main process and the renderer, and writes a marker file `.built`
// last, so that an interrupted build is redone and a finished one is reused. Prints the directory
// on its last line. Usable as a module (`ensureMosaic`) or as a command.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = ".built";

export function readPin() {
  return JSON.parse(readFileSync(join(here, "mosaic-pin.json"), "utf8"));
}

/** The directory MosAIc is built in for the pinned commit. */
export function mosaicDir(pin = readPin()) {
  return join(here, ".mosaic", pin.commit);
}

function run(cmd, args, cwd) {
  console.error(`[build-mosaic] ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: ["ignore", process.stderr, process.stderr] });
}

/** Builds MosAIc if the marker is absent; returns the directory. */
export function ensureMosaic() {
  const pin = readPin();
  const dir = mosaicDir(pin);
  if (existsSync(join(dir, MARKER))) return dir;
  // A directory without the marker is an interrupted build: start again from nothing.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  run("git", ["clone", "--quiet", pin.repository, dir], here);
  run("git", ["checkout", "--quiet", pin.commit], dir);
  run("npm", ["ci", "--no-audit", "--no-fund"], dir);
  // The build check of MosAIc's own CI does the same for its Gmail credentials file.
  const example = join(dir, "config", "gmail-credentials.example.json");
  const target = join(dir, "config", "gmail-credentials.json");
  if (existsSync(example) && !existsSync(target)) copyFileSync(example, target);
  run("npm", ["run", "build:electron"], dir);
  run("npm", ["run", "build:renderer"], dir);
  for (const f of ["dist/main/main.js", "dist/main/preload.js", "dist/renderer/index.html"]) {
    if (!existsSync(join(dir, f))) throw new Error(`the build did not produce ${f}`);
  }
  writeFileSync(join(dir, MARKER), `${pin.commit}\n`);
  return dir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(ensureMosaic());
}
