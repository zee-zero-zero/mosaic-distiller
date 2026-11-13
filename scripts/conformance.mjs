// The conformance runner (§5.5). It reads conformance/rules.jsonl and conformance/golden.jsonl,
// runs every case (or, in the quick tier, a fixed sample: every fifth case), writes one result line
// per case to conformance/results.jsonl, prints a summary with the number of cases, and exits
// non-zero on any failure. Run with: node --import tsx scripts/conformance.mjs [--sample|--full]
import { readFileSync, writeFileSync } from "node:fs";
import { createEngine, loadProfile, loadRulePack } from "../packages/core/src/index.ts";
import { runGoldenCase, runRuleCase } from "../packages/core/src/conformance.ts";

const root = new URL("../", import.meta.url).pathname;
const lines = (p) =>
  readFileSync(root + p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
const json = (p) => JSON.parse(readFileSync(root + p, "utf8"));

const flag = process.argv.includes("--full")
  ? "full"
  : process.argv.includes("--sample")
    ? "sample"
    : null;
const sample =
  flag === "sample" || (flag === null && (process.env.DISTILLER_TIER ?? "quick") === "quick");
const every = (xs) => (sample ? xs.filter((_, i) => i % 5 === 0) : xs);

const pack = loadRulePack(json("rulepacks/default.json"));
const builtIn = ["agent", "document"].map((n) => json(`profiles/${n}.json`));
const engine = createEngine({
  pack,
  profiles: builtIn.map((p) => loadProfile(p, pack)),
  defaultProfile: "agent",
});

const results = [];
for (const c of every(lines("conformance/rules.jsonl")))
  results.push({ kind: "rule", ...runRuleCase(engine, c) });
for (const c of every(lines("conformance/golden.jsonl")))
  results.push({ kind: "golden", ...runGoldenCase(pack, builtIn, c) });

writeFileSync(
  root + "conformance/results.jsonl",
  results.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
const failed = results.filter((r) => !r.pass);
const rules = results.filter((r) => r.kind === "rule").length;
console.log(
  `conformance (${sample ? "sample" : "full"}): ${results.length} cases (${rules} rule, ${results.length - rules} golden), ${failed.length} failed`,
);
for (const f of failed) console.log(`  FAIL ${f.id}: ${f.detail ?? ""}`);
process.exit(failed.length === 0 ? 0 : 1);
