// Provides overlap resolution (§2.6): hits that overlap or touch are merged into one span, which
// takes the category of the longest hit; on a tie, the first family in the family order; on a tie
// within a family, the rule id first in code-point order. A neutralise literal inside a merged
// span always wins, because consumer markup is always neutralised.
import { cmpCodePoints } from "./util";
import type { Hit } from "./types";

export const FAMILY_ORDER = [
  "secret",
  "gov_id",
  "health_id",
  "financial",
  "contact",
  "network",
  "vehicle",
  "org_id",
  "dictionary",
  "inject",
  "hidden",
];

function familyRank(category: string): number {
  const dot = category.indexOf(".");
  const family = dot < 0 ? category : category.slice(0, dot);
  const i = FAMILY_ORDER.indexOf(family);
  return i < 0 ? FAMILY_ORDER.length : i;
}

/** True when `a` beats `b` as the winner of a merged span. */
function beats(a: Hit, b: Hit): boolean {
  const la = a.end - a.start;
  const lb = b.end - b.start;
  if (la !== lb) return la > lb;
  const fa = familyRank(a.category);
  const fb = familyRank(b.category);
  if (fa !== fb) return fa < fb;
  return cmpCodePoints(a.rule, b.rule) < 0;
}

export interface Span {
  start: number;
  end: number;
  winner: Hit;
}

export function mergeHits(hits: Hit[]): Span[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start || a.end - b.end);
  const spans: Span[] = [];
  let cur: Span | null = null;
  let forced: Hit | null = null;
  const flush = (): void => {
    if (cur !== null) {
      if (forced !== null) cur.winner = forced;
      spans.push(cur);
    }
  };
  for (const h of sorted) {
    if (cur !== null && h.start <= cur.end) {
      cur.end = Math.max(cur.end, h.end);
      if (beats(h, cur.winner)) cur.winner = h;
    } else {
      flush();
      cur = { start: h.start, end: h.end, winner: h };
      forced = null;
    }
    if (h.forced !== undefined && (forced === null || beats(h, forced))) forced = h;
  }
  flush();
  return spans;
}
