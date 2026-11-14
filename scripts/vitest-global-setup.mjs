// Vitest's global set-up: in the local and full tiers, builds the server (and the installer, once
// its build script exists) before any test runs, so that the tests that start processes always run
// the bundle of the current source, and never a stale one. In the quick tier nothing starts a
// process and nothing is built.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));

export default function setup() {
  const tier = process.env.DISTILLER_TIER;
  if (tier !== "local" && tier !== "full") return;
  for (const script of ["scripts/build-server.mjs", "scripts/build-installer.mjs"]) {
    if (!existsSync(root + script)) continue;
    const r = spawnSync(process.execPath, [root + script], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
    }
  }
}
