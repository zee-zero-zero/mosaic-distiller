// Provides the conformance runner's logic (§5.5): reading nothing and writing nothing, it checks
// one rule case or one golden case against an engine. A rule case says a rule fires on a text, or
// does not, and why (the pattern never matched, an edge rejected it, or a validator did). A golden
// case pairs a whole request with its whole expected result, compared byte for byte. Requests may
// use three expansions so that limit cases stay small: `{"$repeat": [text, count]}` stands for a
// string, `{"$list": [count, template]}` for a list of strings (`{i}` is the index), and
// `{"$segments": [count, text]}` for a list of segments with ids s1, s2, ….
import { createEngine } from "./engine";
import { loadProfile } from "./rulepack";
import { serializeResult } from "./result";
import type { DistillRefusal, DistillResult } from "./schema";
import type { Engine } from "./engine";
import type { RulePack } from "./types";

export interface RuleCase {
  id: string;
  rule: string;
  text: string;
  expect: "hit" | "none";
  category?: string;
  variant?: string;
  why?: "validator" | "edge" | "pattern";
}

export interface GoldenCase {
  id: string;
  /** Profiles the case adds to the built-in ones, as profile files. */
  profiles?: unknown[];
  request: unknown;
  result: unknown;
}

export interface CaseOutcome {
  id: string;
  pass: boolean;
  detail?: string;
}

/** The marker standing for the Unicode version in a golden result, which differs by machine. */
export const UNICODE_PLACEHOLDER = "<unicode>";

export function expandRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandRequest);
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$repeat") {
      const [text, count] = o.$repeat as [string, number];
      return text.repeat(count);
    }
    if (keys.length === 1 && keys[0] === "$list") {
      const [count, template] = o.$list as [number, string];
      return Array.from({ length: count }, (_, i) => template.split("{i}").join(String(i)));
    }
    if (keys.length === 1 && keys[0] === "$segments") {
      const [count, text] = o.$segments as [number, string];
      return Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, text }));
    }
    return Object.fromEntries(keys.map((k) => [k, expandRequest(o[k])]));
  }
  return value;
}

export function runRuleCase(engine: Engine, c: RuleCase): CaseOutcome {
  const r = engine.distill({ segments: [{ id: "1", text: c.text }] }) as
    DistillResult | DistillRefusal;
  if ("error" in r) return { id: c.id, pass: false, detail: `refused: ${r.error.code}` };
  const counters = r.provenance.counters[c.rule];
  if (counters === undefined) return { id: c.id, pass: false, detail: `no rule ${c.rule}` };
  if (c.expect === "hit") {
    if (counters.fired < 1) return { id: c.id, pass: false, detail: "the rule did not fire" };
    const records = [...(r.removals ?? []), ...(r.findings ?? [])].filter((x) => x.rule === c.rule);
    for (const rec of records) {
      if (rec.category !== c.category) return { id: c.id, pass: false, detail: "wrong category" };
      if (c.variant !== undefined && rec.variant !== c.variant)
        return { id: c.id, pass: false, detail: "wrong variant" };
    }
    return { id: c.id, pass: true };
  }
  if (counters.fired !== 0) return { id: c.id, pass: false, detail: "the rule fired" };
  if (c.why === "validator" && counters.rejected_validator < 1)
    return { id: c.id, pass: false, detail: "no validator rejection" };
  if (c.why === "edge" && counters.rejected_edge < 1)
    return { id: c.id, pass: false, detail: "no edge rejection" };
  if (c.why === "pattern" && counters.candidates !== 0)
    return { id: c.id, pass: false, detail: "the pattern matched" };
  return { id: c.id, pass: true };
}

/** The serialised result with the machine's Unicode version replaced by its placeholder. */
export function normalisedResult(r: DistillResult | DistillRefusal): string {
  const s = serializeResult(r);
  if ("error" in r) return s;
  return s.replace(
    `"unicode":${JSON.stringify(r.provenance.engine.unicode)}`,
    `"unicode":"${UNICODE_PLACEHOLDER}"`,
  );
}

export function runGoldenCase(
  pack: RulePack,
  builtInProfiles: unknown[],
  c: GoldenCase,
): CaseOutcome {
  const profiles = [...builtInProfiles, ...(c.profiles ?? [])].map((p) => loadProfile(p, pack));
  const engine = createEngine({ pack, profiles, defaultProfile: "agent" });
  const actual = normalisedResult(engine.distill(expandRequest(c.request) as never));
  const expected = JSON.stringify(c.result);
  if (actual === expected) return { id: c.id, pass: true };
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at++;
  return {
    id: c.id,
    pass: false,
    detail: `differs at byte ${at}: expected …${expected.slice(Math.max(0, at - 30), at + 50)}… but got …${actual.slice(Math.max(0, at - 30), at + 50)}…`,
  };
}
