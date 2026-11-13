// The seeded-defect run (§5.1, §5.3). Each row of the table names a mechanism, a file, an exact
// piece of source text and its replacement, which disables the mechanism, and the case ids that
// must then fail. For each row the script copies the repository to a temporary directory, applies
// the replacement (the run fails if the source text is not found exactly once, so a refactor
// cannot quietly disarm a row), runs the named cases, and records whether they failed. It writes
// the table to docs/seeded-defects.md. A row whose cases still pass is a test that could never
// fail, and the script exits non-zero.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;

/** @type {{mechanism: string, file: string, find: string, replace: string, cases: string[]}[]} */
export const rows = [
  {
    mechanism:
      "Normaliser off (invisible characters are not classified, so none is dropped from the scan view)",
    file: "packages/core/src/text/scanview.ts",
    find: "    const c = cps[i] as number;\n    if (c < 0xad) continue;",
    replace: "    const c = cps[i] as number;\n    if (c < 0xad || c >= 0) continue;",
    cases: ["ENG-4", "ENG-5"],
  },
  {
    mechanism: "Overlap resolution off (hits are never merged)",
    file: "packages/core/src/resolve.ts",
    find: "if (cur !== null && h.start <= cur.end) {",
    replace: "if (cur !== null && h.start < 0) {",
    cases: ["ENG-7"],
  },
  {
    mechanism: "Same-value numbering off (every occurrence is a new value)",
    file: "packages/core/src/fakes.ts",
    find: "if (known !== undefined) return known;",
    replace: 'if (known !== undefined && key === "") return known;',
    cases: ["ENG-8"],
  },
  {
    mechanism: "Allocation checks off (a fake is not checked against the rules or the input)",
    file: "packages/core/src/fakes.ts",
    find: "private readonly checks = { alone: true, inInput: true },",
    replace: "private readonly checks = { alone: false, inInput: false },",
    cases: ["ENG-9", "ENG-10"],
  },
  {
    mechanism: "Edge check off (every match passes its edges)",
    file: "packages/core/src/pattern/scan.ts",
    find: "if (!edgeAccepts(rule.edges, cps, s, e)) {",
    replace: "if (!edgeAccepts(rule.edges, cps, s, e) && cps.length < 0) {",
    cases: ["ENG-11"],
  },
  {
    mechanism: "Defend rules off (defend hits are dropped)",
    file: "packages/core/src/engine.ts",
    find: "for (const h of hits) (this.isDefend(h.category) ? defend : plain).push(h);",
    replace: "for (const h of hits) if (!this.isDefend(h.category)) plain.push(h);",
    cases: ["ENG-16"],
  },
  {
    mechanism: "The redactor skips the last value of a segment",
    file: "packages/core/src/distillate.ts",
    find: "for (const op of uniteOps(ops)) {",
    replace: "for (const op of uniteOps(ops).slice(0, -1)) {",
    cases: ["ENG-1"],
  },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), "seeded-"));
  cpSync(root, dir, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(root.length);
      return !/^(?:\.git|node_modules|coverage|dist|rigs\/e2e\/\.mosaic)(?:\/|$)/.test(rel);
    },
  });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  return dir;
}

/** Runs the named cases in `dir`; returns, for each id, the number of tests that ran and failed. */
function runCases(dir, ids) {
  const out = join(dir, "vitest-seeded.json");
  const pattern = "^(?:" + ids.map((i) => `${i}(?![0-9])`).join("|") + ")";
  spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "-t",
      pattern,
      "--reporter=json",
      `--outputFile=${out}`,
    ],
    {
      cwd: dir,
      env: { ...process.env, DISTILLER_TIER: "quick" },
      encoding: "utf8",
      maxBuffer: 1 << 28,
    },
  );
  if (!existsSync(out)) throw new Error("vitest wrote no report");
  const report = JSON.parse(readFileSync(out, "utf8"));
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  // A test file that cannot even load (for example, the default pack is refused) fails every case
  // that file holds; the id is looked for in the file's text.
  const broken = report.testResults.filter(
    (f) => f.status === "failed" && f.assertionResults.length === 0,
  );
  const counts = {};
  for (const id of ids) {
    const mine = tests.filter(
      (t) => t.fullName.startsWith(id + " ") && t.status !== "pending" && t.status !== "skipped",
    );
    const unloadable = broken.filter(
      (f) =>
        readFileSync(f.name, "utf8").includes(`"${id} `) ||
        readFileSync(f.name, "utf8").includes(`\`${id} `),
    );
    counts[id] = {
      ran: mine.length,
      failed: mine.filter((t) => t.status === "failed").length + unloadable.length,
      unloadable: unloadable.length,
    };
  }
  return counts;
}

const results = [];
let allCaught = true;
for (const row of rows) {
  if (only.length > 0 && !only.some((o) => row.mechanism.toLowerCase().includes(o.toLowerCase())))
    continue;
  const dir = copyRepo();
  try {
    const before = runCases(dir, row.cases);
    for (const id of row.cases) {
      if (before[id].ran === 0 || before[id].failed > 0) {
        throw new Error(
          `${row.mechanism}: case ${id} does not pass on the unmodified code (ran ${before[id].ran}, failed ${before[id].failed})`,
        );
      }
    }
    const path = join(dir, row.file);
    const source = readFileSync(path, "utf8");
    const found = source.split(row.find).length - 1;
    if (found !== 1) {
      throw new Error(
        `${row.mechanism}: the source text was found ${found} times in ${row.file}, not exactly once; the row is disarmed`,
      );
    }
    writeFileSync(
      path,
      source.replace(row.find, () => row.replace),
    );
    const after = runCases(dir, row.cases);
    const caught = row.cases.every((id) => after[id].failed > 0);
    if (!caught) allCaught = false;
    results.push({ row, after, caught });
    console.log(
      `${caught ? "caught " : "MISSED "} ${row.mechanism}: ` +
        row.cases.map((id) => `${id} ${after[id].failed}/${after[id].ran} failed`).join(", "),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (only.length === 0) {
  const lines = [
    "# Seeded defects",
    "",
    "For each core mechanism, the tests are run against a copy of the code with that mechanism",
    "disabled, and must fail (`docs/spec/05-testing.md` §5.1). A row whose cases still pass is a test",
    "that could never fail. Written by `scripts/seeded-defects.mjs`; do not edit by hand.",
    "",
    "| Mechanism disabled | File | Cases that must fail | Failed / ran | Caught |",
    "|---|---|---|---|---|",
  ];
  for (const { row, after, caught } of results) {
    lines.push(
      `| ${row.mechanism} | \`${row.file}\` | ${row.cases.join(", ")} | ${row.cases.map((id) => `${id}: ${after[id].failed}/${after[id].ran}${after[id].unloadable > 0 ? " (suite refused to load)" : ""}`).join("; ")} | ${caught ? "yes" : "**NO**"} |`,
    );
  }
  lines.push("");
  writeFileSync(join(root, "docs/seeded-defects.md"), lines.join("\n"));
}
process.exit(allCaught ? 0 : 1);
