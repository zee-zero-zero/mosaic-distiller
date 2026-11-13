// Provides the edge checks (§2.4.3): conditions on the scan-view characters just outside a whole
// match, which replace `\b` and lookbehind. They are checked in code, after a match.
import type { Edges } from "../schema";

function isWord(c: number | undefined): boolean {
  return (
    c !== undefined &&
    ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f)
  );
}
function isDigit(c: number | undefined): boolean {
  return c !== undefined && c >= 0x30 && c <= 0x39;
}

/** True when the match [start, end) of the scan view `cps` is accepted by the edge rule. */
export function edgeAccepts(edges: Edges, cps: Uint32Array, start: number, end: number): boolean {
  if (edges === "none") return true;
  const before = start > 0 ? cps[start - 1] : undefined;
  const after = end < cps.length ? cps[end] : undefined;
  if (edges === "word_before") {
    return !(isWord(before) || before === 0x2d);
  }
  if (isWord(before) || isWord(after)) return false;
  if (edges === "word_colon") return before !== 0x3a && after !== 0x3a;
  if (edges === "word") return true;
  // numeric
  if ((before === 0x2e || before === 0x2d) && isDigit(start > 1 ? cps[start - 2] : undefined)) {
    return false;
  }
  if (
    (after === 0x2e || after === 0x2d) &&
    isDigit(end + 1 < cps.length ? cps[end + 1] : undefined)
  ) {
    return false;
  }
  return true;
}
