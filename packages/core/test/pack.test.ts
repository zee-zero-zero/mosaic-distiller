// Tests of the default rule pack against its conformance rule cases (VAL-1) and its structure:
// every rule has a hit case and a not-hit case, every category is used, and the extra secret
// shapes hit the sample values gitleaks' own rules carry.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultEngine, defaultPack, readJson, ROOT } from "./helpers";

interface RuleCase {
  id: string;
  rule: string;
  text: string;
  expect: "hit" | "none";
  category?: string;
  variant?: string;
  why?: "validator" | "edge" | "pattern";
}

export function loadRuleCases(): RuleCase[] {
  return readFileSync(ROOT + "conformance/rules.jsonl", "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RuleCase);
}

const cases = loadRuleCases();

describe("VAL-1 every example of §3", () => {
  const engine = defaultEngine("agent");
  for (const c of cases) {
    it(`VAL-1 ${c.id}`, () => {
      const r: any = engine.distill({ segments: [{ id: "1", text: c.text }] });
      expect(r.error, JSON.stringify(r.error)).toBeUndefined();
      const counters = r.provenance.counters[c.rule];
      expect(counters, `rule ${c.rule} is in the pack`).toBeDefined();
      if (c.expect === "hit") {
        expect(counters.fired).toBeGreaterThanOrEqual(1);
        const records = [...(r.removals ?? []), ...(r.findings ?? [])].filter(
          (x: any) => x.rule === c.rule,
        );
        for (const rec of records) {
          expect(rec.category).toBe(c.category);
          if (c.variant !== undefined) expect(rec.variant).toBe(c.variant);
        }
      } else {
        expect(counters.fired).toBe(0);
        if (c.why === "validator") expect(counters.rejected_validator).toBeGreaterThanOrEqual(1);
        if (c.why === "edge") expect(counters.rejected_edge).toBeGreaterThanOrEqual(1);
        if (c.why === "pattern") expect(counters.candidates).toBe(0);
      }
    });
  }
});

describe("VAL-1 the pack and its cases agree", () => {
  const pack = defaultPack();
  const ruleIds = pack.ruleset.patternRules.map((r) => r.id);
  it("every rule id of the pack has at least one hit case and one not-hit case", () => {
    for (const id of ruleIds) {
      expect(
        cases.some((c) => c.rule === id && c.expect === "hit"),
        `${id} has a hit case`,
      ).toBe(true);
      expect(
        cases.some((c) => c.rule === id && c.expect === "none"),
        `${id} has a not-hit case`,
      ).toBe(true);
    }
  });
  it("every case names a rule of the pack", () => {
    for (const c of cases) expect(ruleIds, c.id).toContain(c.rule);
  });
  it("case ids are unique", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });
  it("every category of the pack is used by a rule or dictionary, except the two the engine uses itself", () => {
    const used = new Set([
      ...pack.ruleset.patternRules.map((r) => r.category),
      ...pack.ruleset.termRules.map((r) => r.category),
    ]);
    for (const c of pack.categories.keys()) {
      if (c === "hidden.invisible" || c === "inject.consumer_markup") continue;
      expect(used.has(c), `${c} is used`).toBe(true);
    }
  });
  it("every category a rule uses is declared (the loader guarantees it; the data says so too)", () => {
    for (const r of pack.ruleset.patternRules) expect(pack.categories.has(r.category)).toBe(true);
  });
  it("the pack's literals are MosAIc's three markers", () => {
    expect(pack.ruleset.literals).toEqual(['"__payment_required"', "<mosaic_ui", "<use_tool"]);
  });
});

describe("VAL-1 gitleaks sample values are hit by our shapes", () => {
  const samples = readJson("config/gitleaks-samples.json") as {
    shape: string;
    gitleaksRule: string;
    samples: string[];
  }[];
  const engine = defaultEngine("agent");
  it("there are samples", () => {
    expect(samples.length).toBeGreaterThan(0);
  });
  for (const s of samples) {
    s.samples.forEach((text, i) => {
      it(`VAL-1 ${s.shape} hits gitleaks' ${s.gitleaksRule} sample ${i + 1}`, () => {
        const r: any = engine.distill({ segments: [{ id: "1", text }] });
        expect(r.provenance.counters[s.shape].fired).toBeGreaterThanOrEqual(1);
      });
    });
  }
});
