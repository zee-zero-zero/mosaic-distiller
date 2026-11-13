// Provides the scan (§2.4.4): each rule scans each segment's scan view leftmost-first, driven by
// `lastIndex`. After a rejection it resumes one code point after the rejected match's start; after
// a zero-length match, one code point on. Edges and validators are checked on the whole match;
// group 1, when present, gives the reported span. Also scans term lists and neutralise literals.
import { edgeAccepts } from "./edges";
import type { ScanView } from "../text/scanview";
import { scanTerms } from "../terms";
import type { CompiledPatternRule, CompiledTermsRule, CountersMap, Hit, Ruleset } from "../types";
import { newCounters } from "../types";

function stepWidth(str: string, index: number): number {
  const c = str.codePointAt(index);
  return c !== undefined && c > 0xffff ? 2 : 1;
}

export function scanPatternRule(
  rule: CompiledPatternRule,
  view: ScanView,
  counters: CountersMap | null,
): Hit[] {
  const c = counters === null ? null : (counters.get(rule.id) ?? null);
  if (c !== null) c.evaluated++;
  const hits: Hit[] = [];
  const { str, u16ToCp, cps } = view;
  const re = rule.re;
  let pos = 0;
  while (pos <= str.length) {
    re.lastIndex = pos;
    const m = re.exec(str);
    if (m === null) break;
    const s16 = m.index;
    const e16 = s16 + m[0].length;
    if (c !== null) c.candidates++;
    const s = u16ToCp[s16] as number;
    const e = u16ToCp[e16] as number;
    if (!edgeAccepts(rule.edges, cps, s, e)) {
      if (c !== null) c.rejected_edge++;
      pos = s16 + stepWidth(str, s16);
      continue;
    }
    let variant = rule.variant;
    let rejected = false;
    for (const v of rule.validators) {
      const r = v.fn(m[0], str.slice(e16, e16 + 2));
      if (!r.ok) {
        rejected = true;
        break;
      }
      if (r.variant !== undefined) variant = r.variant;
    }
    if (rejected) {
      if (c !== null) c.rejected_validator++;
      pos = s16 + stepWidth(str, s16);
      continue;
    }
    let hs = s;
    let he = e;
    if (rule.hasCapture) {
      const idx = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices;
      const g = idx?.[1];
      if (g !== undefined) {
        hs = u16ToCp[g[0]] as number;
        he = u16ToCp[g[1]] as number;
      }
    }
    const hit: Hit = {
      start: hs,
      end: he,
      rule: rule.id,
      category: rule.category,
      action: rule.action,
    };
    if (variant !== undefined) hit.variant = variant;
    hits.push(hit);
    if (c !== null) c.fired++;
    if (e16 === s16) {
      if (e16 >= str.length) break;
      pos = e16 + stepWidth(str, e16);
    } else {
      pos = e16;
    }
  }
  return hits;
}

export function scanTermsRule(
  rule: CompiledTermsRule,
  view: ScanView,
  counters: CountersMap | null,
): Hit[] {
  const c = counters === null ? null : (counters.get(rule.id) ?? null);
  const counts = { candidates: 0, rejected_edge: 0 };
  const found = scanTerms(rule.set, view, counts);
  if (c !== null) {
    c.evaluated++;
    c.candidates += counts.candidates;
    c.rejected_edge += counts.rejected_edge;
    c.fired += found.length;
  }
  return found.map((h) => {
    const hit: Hit = {
      start: h.start,
      end: h.end,
      rule: rule.id,
      category: rule.category,
      action: rule.action,
      term: h.term,
    };
    if (rule.variant !== undefined) hit.variant = rule.variant;
    return hit;
  });
}

/** The neutralise literals, matched as literal text, case-sensitively, on the scan view. */
export function scanLiterals(literals: string[], view: ScanView): Hit[] {
  const hits: Hit[] = [];
  for (const lit of literals) {
    if (lit.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = view.str.indexOf(lit, from);
      if (at < 0) break;
      hits.push({
        start: view.u16ToCp[at] as number,
        end: view.u16ToCp[at + lit.length] as number,
        rule: "inject.consumer_markup",
        category: "inject.consumer_markup",
        action: "neutralise",
        forced: "neutralise",
      });
      from = at + lit.length;
    }
  }
  return hits;
}

/** Runs every rule of the set over one scan view, counting into `counters` when given. */
export function detect(set: Ruleset, view: ScanView, counters: CountersMap | null): Hit[] {
  const hits: Hit[] = [];
  const add = (found: Hit[]): void => {
    for (const h of found) hits.push(h);
  };
  for (const r of set.patternRules) add(scanPatternRule(r, view, counters));
  for (const r of set.termRules) add(scanTermsRule(r, view, counters));
  add(scanLiterals(set.literals, view));
  return hits;
}

export function countersFor(set: Ruleset): CountersMap {
  const m: CountersMap = new Map();
  for (const r of set.patternRules) m.set(r.id, newCounters());
  for (const r of set.termRules) m.set(r.id, newCounters());
  return m;
}
