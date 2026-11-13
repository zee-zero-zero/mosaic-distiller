// Tests of the conformance cases and their runner (§5.5): every golden case passes byte for byte,
// the golden file covers each behaviour of §2, the runner's logic fails when it should, and the
// runner script exits as it should and writes one result line per case.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEngine, loadProfile, loadRulePack } from "../src/index";
import {
  expandRequest,
  runGoldenCase,
  runRuleCase,
  type GoldenCase,
  type RuleCase,
} from "../src/conformance";
import { ROOT, isFullTier, readJson } from "./helpers";

const lines = <T>(p: string): T[] =>
  readFileSync(ROOT + p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);

const golden = lines<GoldenCase>("conformance/golden.jsonl");
const rules = lines<RuleCase>("conformance/rules.jsonl");
const pack = loadRulePack(readJson("rulepacks/default.json"));
const builtIn = ["agent", "document"].map((n) => readJson(`profiles/${n}.json`));

describe("golden: every golden case passes, byte for byte", () => {
  for (const c of golden) {
    it(c.id, () => {
      const out = runGoldenCase(pack, builtIn, c);
      expect(out.detail ?? "").toBe("");
      expect(out.pass).toBe(true);
    });
  }
});

describe("golden: the file covers each behaviour of §2", () => {
  const ids = new Set(golden.map((c) => c.id));
  const needed: [string, string][] = [
    ["each action: redact", "golden/action-redact-agent-private-ip"],
    ["each action: flag", "golden/action-flag-document"],
    ["each action: neutralise", "golden/action-neutralise-agent"],
    ["each action: block", "golden/block"],
    ["profile agent", "golden/action-redact-agent-private-ip"],
    ["profile document", "golden/action-flag-document-private-ip"],
    ["a merge", "golden/merge-url-email"],
    ["a fake skipped because it was taken", "golden/fake-skipped-taken"],
    ["a term list", "golden/term-list"],
    ["an invisible character", "golden/invisible-hidden-ssn"],
    ["a block", "golden/block-invisible"],
    ["limit: no segments", "golden/limit-empty-input"],
    ["limit: too many segments", "golden/limit-too-many-segments"],
    ["limit: text too large", "golden/limit-input-too-large"],
    ["limit: duplicate id", "golden/limit-duplicate-id"],
    ["limit: too many dictionaries", "golden/limit-too-many-dictionaries"],
    ["limit: too many terms", "golden/limit-too-many-terms"],
    ["limit: term too short", "golden/limit-term-too-short"],
    ["limit: term too long", "golden/limit-term-too-long"],
    ["a limit that passes", "golden/limit-segments-at-limit"],
  ];
  for (const [what, id] of needed) {
    it(what, () => expect(ids.has(id), `${id} is missing`).toBe(true));
  }
  it("a golden result is never certified", () => {
    for (const c of golden) {
      const r = c.result as { provenance?: { certified: boolean } };
      if (r.provenance !== undefined) expect(r.provenance.certified).toBe(false);
    }
  });
  it("golden results hold the placeholder, not a machine's Unicode version", () => {
    const text = readFileSync(ROOT + "conformance/golden.jsonl", "utf8");
    expect(text).toContain('"unicode":"<unicode>"');
    expect(text).not.toContain(`"unicode":"${process.versions.unicode}"`);
  });
  it("golden ids are unique", () => {
    expect(ids.size).toBe(golden.length);
  });
  it("the first of two card numbers is redacted when they are separated by punctuation", () => {
    const c = golden.find((g) => g.id === "golden/same-value-same-fake") as GoldenCase;
    const r = c.result as { segments: { distillate: string }[] };
    expect(r.segments[1]?.distillate).toBe(
      "000-00-0001 again 000-00-0001 and 0000 0000 0000 0001, 0000 0000 0000 0001",
    );
  });
});

describe("golden: the runner's logic fails when it should", () => {
  const one = golden.find((c) => c.id === "golden/spec-example") as GoldenCase;
  it("a changed expected distillate fails and reports where", () => {
    const bad = JSON.parse(JSON.stringify(one)) as GoldenCase;
    (bad.result as any).segments[0].distillate = "Write to person9@example.com.";
    const out = runGoldenCase(pack, builtIn, bad);
    expect(out.pass).toBe(false);
    expect(out.detail).toContain("differs at byte");
  });
  it("a changed key order fails: results are compared byte for byte", () => {
    const bad = JSON.parse(JSON.stringify(one)) as GoldenCase;
    const r = bad.result as Record<string, unknown>;
    bad.result = {
      mode: r.mode,
      removals: r.removals,
      segments: r.segments,
      findings: r.findings,
      warnings: r.warnings,
      provenance: r.provenance,
    };
    expect(runGoldenCase(pack, builtIn, bad).pass).toBe(false);
  });
  it("a changed counter fails", () => {
    const bad = JSON.parse(JSON.stringify(one)) as GoldenCase;
    (bad.result as any).provenance.counters["contact.email"].fired = 2;
    expect(runGoldenCase(pack, builtIn, bad).pass).toBe(false);
  });
  it("a rule case that expects a hit fails when the rule does not fire, and one that expects none fails when it fires", () => {
    const engine = createEngine({
      pack,
      profiles: builtIn.map((p) => loadProfile(p, pack)),
      defaultProfile: "agent",
    });
    expect(
      runRuleCase(engine, {
        id: "x",
        rule: "gov_id.us_ssn",
        text: "no number",
        expect: "hit",
        category: "gov_id.us_ssn",
      }).pass,
    ).toBe(false);
    expect(
      runRuleCase(engine, { id: "x", rule: "gov_id.us_ssn", text: "536-22-8914", expect: "none" })
        .pass,
    ).toBe(false);
    expect(
      runRuleCase(engine, {
        id: "x",
        rule: "gov_id.us_ssn",
        text: "536-22-8914",
        expect: "hit",
        category: "wrong.category",
      }).pass,
    ).toBe(false);
    expect(
      runRuleCase(engine, {
        id: "x",
        rule: "gov_id.us_ssn",
        text: "078-05-1120",
        expect: "none",
        why: "edge",
      }).pass,
    ).toBe(false);
    expect(
      runRuleCase(engine, {
        id: "x",
        rule: "gov_id.us_ssn",
        text: "078-05-1120",
        expect: "none",
        why: "pattern",
      }).pass,
    ).toBe(false);
    expect(
      runRuleCase(engine, { id: "x", rule: "no.such.rule", text: "x", expect: "none" }).pass,
    ).toBe(false);
  });
  it("every rule case passes through the runner's logic", () => {
    const engine = createEngine({
      pack,
      profiles: builtIn.map((p) => loadProfile(p, pack)),
      defaultProfile: "agent",
    });
    for (const c of rules) expect(runRuleCase(engine, c), c.id).toMatchObject({ pass: true });
  });
  it("the request expansions", () => {
    expect(
      expandRequest({
        a: { $repeat: ["ab", 3] },
        b: { $list: [3, "t{i}"] },
        c: { $segments: [2, "x"] },
        d: [1, { e: 2 }],
      }),
    ).toEqual({
      a: "ababab",
      b: ["t0", "t1", "t2"],
      c: [
        { id: "s1", text: "x" },
        { id: "s2", text: "x" },
      ],
      d: [1, { e: 2 }],
    });
  });
});

describe("golden: the runner script", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/conformance.mjs", ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
  it("runs a fixed sample, writes one result line per case, and exits 0", () => {
    const r = run("--sample");
    expect(r.status).toBe(0);
    const results = lines<{ id: string; pass: boolean }>("conformance/results.jsonl");
    expect(r.stdout).toContain(`${results.length} cases`);
    expect(results.length).toBe(Math.ceil(rules.length / 5) + Math.ceil(golden.length / 5));
    expect(results.every((x) => x.pass)).toBe(true);
  });
  it.runIf(isFullTier())(
    "runs everything in the local tier, with zero failures and the number of cases reported",
    () => {
      const r = run("--full");
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`${rules.length + golden.length} cases`);
      expect(r.stdout).toContain("0 failed");
      expect(lines("conformance/results.jsonl")).toHaveLength(rules.length + golden.length);
    },
  );
});
