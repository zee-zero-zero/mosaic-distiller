// Provides the parser that is the authority on the portable pattern subset (§2.4.1). It accepts
// exactly the subset and refuses everything else with PACK_PATTERN_SUBSET; JavaScript is used
// only to compile (see compile.ts). This file names the escapes it refuses (`\d`, `\w`, `\s`,
// `\b`), so it is the one file exempt from the determinism check REP-4.
import { RulePackError } from "../schema";

/** A set of code points as sorted, non-overlapping inclusive ranges. */
type Ranges = [number, number][];

export interface ParsedPattern {
  /** Number of capturing groups (0 or 1). */
  groups: number;
  /** Code-point indices of every `^` and `$` outside a character class. */
  anchors: { index: number; char: "^" | "$" }[];
  /** The pattern as code points. */
  cps: number[];
}

interface CharNode {
  t: "char";
  set: Ranges;
}
interface AnchorNode {
  t: "anchor";
}
interface GroupNode {
  t: "group";
  capture: boolean;
  alts: Seq[];
}
type Atom = CharNode | AnchorNode | GroupNode;
interface RepNode {
  t: "rep";
  node: Atom;
  min: number;
  max: number;
}
type Elem = Atom | RepNode;
type Seq = Elem[];

const MAX_REPEAT = 65536;
const SYNTAX = new Set([..."^$\\.*+?()[]{}|/"].map((c) => c.codePointAt(0) as number));
const MAX = 0x10ffff;

function refuse(detail: string): never {
  throw new RulePackError("PACK_PATTERN_SUBSET", detail);
}

// ---- code-point sets -------------------------------------------------------------------------

function normalise(r: Ranges): Ranges {
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: Ranges = [];
  for (const [lo, hi] of s) {
    const last = out[out.length - 1];
    if (last !== undefined && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

function complement(r: Ranges): Ranges {
  const out: Ranges = [];
  let next = 0;
  for (const [lo, hi] of normalise(r)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX) out.push([next, MAX]);
  return out;
}

function intersects(a: Ranges, b: Ranges): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as [number, number];
    const y = b[j] as [number, number];
    if (Math.max(x[0], y[0]) <= Math.min(x[1], y[1])) return true;
    if (x[1] < y[1]) i++;
    else j++;
  }
  return false;
}

function subsetOf(a: Ranges, b: Ranges): boolean {
  // a is a subset of b when a does not meet the complement of b.
  return !intersects(a, complement(b));
}

function union(sets: Ranges[]): Ranges {
  return normalise(sets.flat());
}

// ---- parser ----------------------------------------------------------------------------------

class Parser {
  readonly cps: number[];
  pos = 0;
  groups = 0;
  anchors: { index: number; char: "^" | "$" }[] = [];

  constructor(source: string) {
    this.cps = Array.from(source, (c) => c.codePointAt(0) as number);
  }

  peek(): number | undefined {
    return this.cps[this.pos];
  }

  eof(): boolean {
    return this.pos >= this.cps.length;
  }

  parseTop(): Seq[] {
    if (this.eof()) refuse("the pattern is empty");
    const alts = this.parseAlternation();
    if (!this.eof()) refuse("unmatched ) in pattern");
    return alts;
  }

  parseAlternation(): Seq[] {
    const alts: Seq[] = [this.parseSeq()];
    while (this.peek() === 0x7c) {
      this.pos++;
      alts.push(this.parseSeq());
    }
    return alts;
  }

  parseSeq(): Seq {
    const seq: Seq = [];
    while (!this.eof() && this.peek() !== 0x7c && this.peek() !== 0x29) {
      seq.push(this.parseElem());
    }
    if (seq.length === 0) refuse("an empty alternative or group");
    return seq;
  }

  parseElem(): Elem {
    const atom = this.parseAtom();
    const c = this.peek();
    let min: number;
    let max: number;
    if (c === 0x7b) {
      [min, max] = this.parseBraces();
    } else if (c === 0x3f) {
      this.pos++;
      min = 0;
      max = 1;
    } else if (c === 0x2a || c === 0x2b) {
      return refuse("* and + are not allowed; every repetition must be bounded as {m,n}");
    } else {
      return atom;
    }
    if (atom.t === "anchor") refuse("a quantifier on an anchor");
    const after = this.peek();
    if (after === 0x3f) refuse("a lazy quantifier");
    if (after === 0x2b || after === 0x2a || after === 0x7b) refuse("stacked quantifiers");
    if (atom.t === "group" && atom.capture && max > 1) refuse("a repeated capturing group");
    return { t: "rep", node: atom, min, max };
  }

  parseBraces(): [number, number] {
    // At '{'. Accept {m} and {m,n} only.
    let i = this.pos + 1;
    const digits = (): number | undefined => {
      const start = i;
      let v = 0;
      while (
        i < this.cps.length &&
        (this.cps[i] as number) >= 0x30 &&
        (this.cps[i] as number) <= 0x39
      ) {
        v = v * 10 + ((this.cps[i] as number) - 0x30);
        if (v > 10_000_000) refuse("a repeat count that is too large");
        i++;
      }
      return i === start ? undefined : v;
    };
    const m = digits();
    if (m === undefined) return refuse("a { that is not a bounded quantifier");
    let n = m;
    if (this.cps[i] === 0x2c) {
      i++;
      const hi = digits();
      if (hi === undefined) return refuse("an unbounded {m,} repetition");
      n = hi;
    }
    if (this.cps[i] !== 0x7d) return refuse("a { that is not a bounded quantifier");
    this.pos = i + 1;
    if (n < m) refuse("a repeat range with its maximum below its minimum");
    if (n < 1) refuse("a repeat count of zero");
    if (n > MAX_REPEAT) refuse(`a repeat count above ${MAX_REPEAT}`);
    return [m, n];
  }

  parseAtom(): Atom {
    const c = this.peek() as number;
    const here = this.pos;
    if (c === 0x28) return this.parseGroup();
    if (c === 0x5b) return this.parseClass();
    if (c === 0x5c) {
      const lit = this.parseEscape(false);
      return { t: "char", set: [[lit, lit]] };
    }
    if (c === 0x5e || c === 0x24) {
      this.pos++;
      this.anchors.push({ index: here, char: c === 0x5e ? "^" : "$" });
      return { t: "anchor" };
    }
    if (c === 0x2e) return refuse("the wildcard . (write an explicit class)");
    if (c === 0x2a || c === 0x2b || c === 0x3f)
      return refuse("a quantifier with nothing to repeat");
    if (c === 0x7b || c === 0x7d || c === 0x5d) return refuse("an unescaped { } or ]");
    this.pos++;
    return { t: "char", set: [[c, c]] };
  }

  /** Parses an escape at the backslash; returns the code point it stands for. */
  parseEscape(inClass: boolean): number {
    this.pos++; // the backslash
    const c = this.peek();
    if (c === undefined) return refuse("a trailing backslash");
    this.pos++;
    if (SYNTAX.has(c)) return c;
    if (c === 0x2d && inClass) return c;
    if (c === 0x74) return 0x09;
    if (c === 0x6e) return 0x0a;
    if (c === 0x72) return 0x0d;
    const ch = String.fromCodePoint(c);
    if ("dwsDWSbB".includes(ch)) return refuse(`the class escape \\${ch}`);
    if (c >= 0x30 && c <= 0x39) return refuse("a backreference or numeric escape");
    if (ch === "p" || ch === "P") return refuse("a Unicode property escape");
    return refuse(`the escape \\${ch}`);
  }

  parseGroup(): GroupNode {
    this.pos++; // (
    let capture = true;
    if (this.peek() === 0x3f) {
      const nx = this.cps[this.pos + 1];
      if (nx === 0x3a) {
        capture = false;
        this.pos += 2;
      } else {
        return refuse("a lookaround, named group or inline flag");
      }
    }
    if (capture) {
      this.groups++;
      if (this.groups > 1) refuse("more than one capturing group");
    }
    const alts = this.parseAlternation();
    if (this.peek() !== 0x29) return refuse("an unclosed group");
    this.pos++;
    return { t: "group", capture, alts };
  }

  parseClass(): CharNode {
    this.pos++; // [
    let negated = false;
    if (this.peek() === 0x5e) {
      negated = true;
      this.pos++;
    }
    const ranges: Ranges = [];
    let count = 0;
    for (;;) {
      const c = this.peek();
      if (c === undefined) return refuse("an unclosed character class");
      if (c === 0x5d) {
        this.pos++;
        break;
      }
      if (c === 0x5b && this.cps[this.pos + 1] === 0x3a) return refuse("a POSIX class [:name:]");
      const lo = this.classChar();
      count++;
      if (
        this.peek() === 0x2d &&
        this.cps[this.pos + 1] !== 0x5d &&
        this.cps[this.pos + 1] !== undefined
      ) {
        this.pos++; // -
        const hi = this.classChar();
        if (hi < lo) return refuse("a character range in descending order");
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    if (count === 0) return refuse("an empty character class");
    const set = normalise(ranges);
    return { t: "char", set: negated ? complement(set) : set };
  }

  classChar(): number {
    const c = this.peek() as number;
    if (c === 0x5c) return this.parseEscape(true);
    this.pos++;
    return c;
  }
}

// ---- structural checks -----------------------------------------------------------------------

function minLen(e: Elem): number {
  switch (e.t) {
    case "char":
      return 1;
    case "anchor":
      return 0;
    case "group":
      return Math.min(...e.alts.map((s) => s.reduce((n, x) => n + minLen(x), 0)));
    case "rep":
      return e.min * minLen(e.node);
  }
}

function firstSet(e: Elem): Ranges {
  switch (e.t) {
    case "char":
      return e.set;
    case "anchor":
      return [];
    case "group":
      return union(e.alts.map(seqFirst));
    case "rep":
      return firstSet(e.node);
  }
}

function seqFirst(s: Seq): Ranges {
  const parts: Ranges[] = [];
  for (const e of s) {
    parts.push(firstSet(e));
    if (minLen(e) > 0) break;
  }
  return union(parts);
}

function allChars(e: Elem): Ranges {
  switch (e.t) {
    case "char":
      return e.set;
    case "anchor":
      return [];
    case "group":
      return union(e.alts.map((s) => union(s.map(allChars))));
    case "rep":
      return allChars(e.node);
  }
}

/** The characters a variable-length repetition at the end of `e` could consume. */
function varTail(e: Elem): Ranges {
  switch (e.t) {
    case "char":
    case "anchor":
      return [];
    case "group":
      return union(e.alts.map(seqVarTail));
    case "rep":
      return e.min < e.max ? allChars(e.node) : varTail(e.node);
  }
}

function seqVarTail(s: Seq): Ranges {
  const parts: Ranges[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const e = s[i] as Elem;
    parts.push(varTail(e));
    if (minLen(e) > 0) break;
  }
  return union(parts);
}

/** A sequence of fixed-width single-character atoms as a list of sets, or undefined. */
function flatten(s: Seq): Ranges[] | undefined {
  const out: Ranges[] = [];
  for (const e of s) {
    if (e.t === "char") out.push(e.set);
    else if (e.t === "rep" && e.node.t === "char" && e.min === e.max && e.max <= 256) {
      for (let k = 0; k < e.max; k++) out.push(e.node.set);
    } else return undefined;
  }
  return out;
}

function checkAlternatives(alts: Seq[], terminal: boolean): void {
  if (!terminal || alts.length < 2) return;
  const flat = alts.map(flatten);
  for (let i = 0; i < alts.length; i++) {
    for (let j = i + 1; j < alts.length; j++) {
      const a = flat[i];
      const b = flat[j];
      if (a === undefined || b === undefined || a.length >= b.length) continue;
      if (a.every((set, k) => subsetOf(b[k] as Ranges, set))) {
        refuse("alternatives that share a prefix, written shortest first (write the longer first)");
      }
    }
  }
}

function checkSeq(seq: Seq, terminal: boolean): void {
  for (let i = 0; i < seq.length; i++) {
    const e = seq[i] as Elem;
    const rest = seq.slice(i + 1);
    const tail = terminal && rest.every((x) => minLen(x) === 0);
    if (e.t === "group") {
      checkAlternatives(e.alts, tail);
      for (const a of e.alts) checkSeq(a, tail);
    } else if (e.t === "rep" && e.node.t === "group") {
      const g = e.node;
      for (const a of g.alts) checkSeq(a, false);
      checkAlternatives(g.alts, false);
      if (e.max > 1) {
        const first = union(g.alts.map(seqFirst));
        const prev = seq[i - 1];
        if (prev !== undefined && intersects(varTail(prev), first)) {
          refuse(
            "a repeated group that can begin with a character the repetition before it can match",
          );
        }
        for (const a of g.alts) {
          if (intersects(seqVarTail(a), first)) {
            refuse(
              "a repeated group whose iterations can begin with a character the previous one can end with",
            );
          }
        }
      }
    }
  }
}

/** Parses `source` against the portable subset; throws RulePackError(PACK_PATTERN_SUBSET). */
export function parsePattern(source: string): ParsedPattern {
  const p = new Parser(source);
  const alts = p.parseTop();
  checkAlternatives(alts, true);
  for (const a of alts) checkSeq(a, true);
  return { groups: p.groups, anchors: p.anchors, cps: p.cps };
}
