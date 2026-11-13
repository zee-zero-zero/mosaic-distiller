// Runs vitest for one test tier (quick, local or full), with the tier's time budget enforced.
// The tier reaches the tests through the DISTILLER_TIER environment variable (§5.2).
import { spawnSync } from "node:child_process";

const budgets = { quick: 60, local: 15 * 60, full: 60 * 60 };
const tier = process.argv[2];
if (!(tier in budgets)) {
  console.error("usage: run-tier.mjs quick|local|full");
  process.exit(2);
}
const started = Date.now();
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(3)],
  { stdio: "inherit", env: { ...process.env, DISTILLER_TIER: tier } },
);
const seconds = (Date.now() - started) / 1000;
console.log(`\n[${tier}] finished in ${seconds.toFixed(1)} s (budget ${budgets[tier]} s)`);
if (result.status !== 0) process.exit(result.status ?? 1);
if (seconds > budgets[tier]) {
  console.error(`[${tier}] over its time budget`);
  process.exit(1);
}
