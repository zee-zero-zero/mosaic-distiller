// Provides term lists (§2.5): folding one code point at a time, a trie over folded terms, and
// matching with letter-and-digit boundaries. Terms are literals: they are never compiled as
// patterns. A match reports its scan-view span and the term it matched; terms never reach a
// record, counter or log.
import { cmpCodePoints } from "./util";
import type { ScanView } from "./text/scanview";
import { fromCodePoints } from "./text/codepoints";

const WHITE = /^\p{White_Space}$/u;
const MARK = /^\p{Mn}$/u;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

/** A folded code point with the scan-view code point it came from. */
export interface Folded {
  cps: number[];
  /** Index of the source scan-view code point of each folded code point. */
  src: number[];
  /** Exclusive end of the source range (more than src+1 only for a folded run of white space). */
  srcEnd: number[];
  /** True when the folded code point is the first, or the last, one its source produced. */
  first: boolean[];
  last: boolean[];
}

export function foldCodePoints(input: ArrayLike<number>): Folded {
  const out: Folded = { cps: [], src: [], srcEnd: [], first: [], last: [] };
  let inSpace = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i] as number;
    const ch = String.fromCodePoint(c);
    if (WHITE.test(ch)) {
      if (inSpace) {
        out.srcEnd[out.srcEnd.length - 1] = i + 1;
      } else {
        out.cps.push(0x20);
        out.src.push(i);
        out.srcEnd.push(i + 1);
        out.first.push(true);
        out.last.push(true);
        inSpace = true;
      }
      continue;
    }
    inSpace = false;
    const pieces: number[] = [];
    for (const d of ch.toLowerCase().normalize("NFKD")) {
      if (!MARK.test(d)) pieces.push(d.codePointAt(0) as number);
    }
    for (let k = 0; k < pieces.length; k++) {
      out.cps.push(pieces[k] as number);
      out.src.push(i);
      out.srcEnd.push(i + 1);
      out.first.push(k === 0);
      out.last.push(k === pieces.length - 1);
    }
  }
  return out;
}

/** The folded form of a term, as code points. */
export function foldTerm(term: string): number[] {
  const cps = Array.from(term, (c) => c.codePointAt(0) as number);
  return foldCodePoints(cps).cps;
}

interface TrieNode {
  children: Map<number, TrieNode>;
  /** The folded term ending here, as a string, when a term ends here. */
  term?: string;
}

export interface TermSet {
  /** The category and rule id, e.g. `dictionary.contacts`. */
  id: string;
  root: TrieNode;
  maxLen: number;
}

export function buildTermSet(id: string, terms: string[]): TermSet {
  const root: TrieNode = { children: new Map() };
  let maxLen = 0;
  for (const t of terms) {
    const f = foldTerm(t);
    if (f.length === 0) continue;
    maxLen = Math.max(maxLen, f.length);
    let n = root;
    for (const c of f) {
      let next = n.children.get(c);
      if (next === undefined) {
        next = { children: new Map() };
        n.children.set(c, next);
      }
      n = next;
    }
    n.term = fromCodePoints(f);
  }
  return { id, root, maxLen };
}

export interface TermHit {
  start: number;
  end: number;
  /** The folded term matched; the same value gets the same fake (§2.8). */
  term: string;
}

export interface TermCounts {
  candidates: number;
  rejected_edge: number;
}

function isLetterOrDigit(c: number | undefined): boolean {
  if (c === undefined) return false;
  if (c < 0x80)
    return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  return LETTER_OR_DIGIT.test(String.fromCodePoint(c));
}

/** Finds the terms of `set` in the scan view: leftmost, then longest, then folded form first. */
export function scanTerms(set: TermSet, view: ScanView, counts: TermCounts): TermHit[] {
  const f = foldCodePoints(view.cps);
  const hits: TermHit[] = [];
  const n = f.cps.length;
  let i = 0;
  while (i < n) {
    // Collect candidates starting at i.
    let node: TrieNode | undefined = set.root;
    let best: { j: number; term: string } | undefined;
    const accepted: { j: number; term: string }[] = [];
    for (let j = i; j < n; j++) {
      node = node.children.get(f.cps[j] as number);
      if (node === undefined) break;
      if (node.term === undefined) continue;
      counts.candidates++;
      // The match covers folded code points i..j.
      const s = f.src[i] as number;
      const e = f.srcEnd[j] as number;
      const whole = f.first[i] === true && f.last[j] === true;
      const before = s > 0 ? view.cps[s - 1] : undefined;
      const after = e < view.cps.length ? view.cps[e] : undefined;
      if (!whole || isLetterOrDigit(before) || isLetterOrDigit(after)) {
        counts.rejected_edge++;
        continue;
      }
      accepted.push({ j, term: node.term });
    }
    for (const a of accepted) {
      if (best === undefined || a.j > best.j) best = a;
      else if (a.j === best.j && cmpCodePoints(a.term, best.term) < 0) best = a;
    }
    if (best !== undefined) {
      hits.push({ start: f.src[i] as number, end: f.srcEnd[best.j] as number, term: best.term });
      // Resume after the match: the next folded code point whose source starts at or after end.
      const end = f.srcEnd[best.j] as number;
      let k = best.j + 1;
      while (k < n && (f.src[k] as number) < end) k++;
      i = k;
    } else {
      i++;
    }
  }
  return hits;
}
