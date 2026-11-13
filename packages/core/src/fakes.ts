// Provides fake-value allocation (§2.8): the templates, the shape-preserving form, and the
// allocator that gives each distinct value its fake. A candidate is accepted only when no rule
// hits it on its own and it occurs nowhere in the request's input; both are checked, not assumed.
import { detect } from "./pattern/scan";
import type { CompiledPatternRule } from "./types";
import { buildScanView } from "./text/scanview";
import type { CategoryDecl } from "./schema";
import type { Ruleset } from "./types";

export const BUILTIN_SURROGATES = [
  "shape",
  "mask",
  "email",
  "phone",
  "ipv4",
  "ipv6",
  "mac",
  "postal",
] as const;

export function surrogateIsValid(s: string): boolean {
  return (BUILTIN_SURROGATES as readonly string[]).includes(s) || s.includes("{n}");
}

const DIGIT = /^\p{Nd}$/u;
const LETTER = /^\p{L}$/u;

/**
 * The shape-preserving form: each digit becomes 0, each letter X (x if lower case, or
 * `fixedLetter` when given), every other character is kept; then n is written in decimal into the
 * rightmost digit positions. Returns null when n has more digits than there are positions.
 */
export function shapeForm(text: string, n: number, fixedLetter?: string): string | null {
  const chars = Array.from(text);
  const digitAt: number[] = [];
  const out = chars.map((ch, i) => {
    if (DIGIT.test(ch)) {
      digitAt.push(i);
      return "0";
    }
    if (LETTER.test(ch)) {
      if (fixedLetter !== undefined) return fixedLetter;
      return ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? "x" : "X";
    }
    return ch;
  });
  const digits = String(n);
  if (digits.length > digitAt.length) return null;
  for (let k = 0; k < digits.length; k++) {
    out[digitAt[digitAt.length - digits.length + k] as number] = digits[k] as string;
  }
  return out.join("");
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/** The n-th fake of a surrogate, or null when the template has run out. */
export function makeFake(
  surrogate: string,
  variant: string | undefined,
  n: number,
  sample: string,
): string | null {
  switch (surrogate) {
    case "mask":
      return "***";
    case "email":
      return `person${n}@example.com`;
    case "phone":
      return n <= 99 ? `(202) 555-01${String(n).padStart(2, "0")}` : `(202) 555-0100 ext. ${n}`;
    case "ipv4":
      if (n <= 254) return `192.0.2.${n}`;
      if (n <= 508) return `198.51.100.${n - 254}`;
      if (n <= 762) return `203.0.113.${n - 508}`;
      return null;
    case "ipv6":
      return n <= 0xffff ? `2001:db8::${hex(n, 1)}` : null;
    case "mac":
      return n <= 255 ? `00:00:5e:00:53:${hex(n, 2)}` : null;
    case "postal":
      if (variant === "ca") return shapeForm(sample, n, "D");
      if (variant === "jp") return shapeForm(sample.replace(/^〒[ ]?/u, ""), n);
      return shapeForm(sample, n);
    case "shape":
      return shapeForm(sample, n);
    default:
      return surrogate.split("{n}").join(String(n));
  }
}

/**
 * A conservative prefilter for "can any pattern rule match here at all?": every rule's compiled
 * source with capture groups made non-capturing, joined by `|`, one regexp for the rules that are
 * case-sensitive and one for those that are not. When neither finds anything in a candidate, no
 * rule has even a candidate match there, so the exact scan can be skipped. When one finds
 * something, the exact scan decides, so the prefilter can only save work, never change an answer.
 */
interface Prefilter {
  sensitive: RegExp | null;
  insensitive: RegExp | null;
}
const prefilters = new WeakMap<CompiledPatternRule[], Prefilter>();

function withoutCaptures(source: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    if (c === "\\") {
      out += c + (source[i + 1] ?? "");
      i++;
    } else if (inClass) {
      if (c === "]") inClass = false;
      out += c;
    } else if (c === "[") {
      inClass = true;
      out += c;
    } else if (c === "(" && source[i + 1] !== "?") {
      out += "(?:";
    } else {
      out += c;
    }
  }
  return out;
}

function prefilterFor(rules: CompiledPatternRule[]): Prefilter {
  let p = prefilters.get(rules);
  if (p === undefined) {
    const sens: string[] = [];
    const insens: string[] = [];
    for (const r of rules) {
      (r.re.flags.includes("i") ? insens : sens).push(`(?:${withoutCaptures(r.re.source)})`);
    }
    p = {
      sensitive: sens.length > 0 ? new RegExp(sens.join("|"), "u") : null,
      insensitive: insens.length > 0 ? new RegExp(insens.join("|"), "iu") : null,
    };
    prefilters.set(rules, p);
  }
  return p;
}

/** A Bloom filter over the UTF-16 trigrams of the input, to rule out most substring searches. */
class TrigramFilter {
  private readonly bits: Uint8Array;
  private readonly mask: number;
  constructor(texts: string[]) {
    let total = 0;
    for (const t of texts) total += t.length;
    let size = 1 << 16;
    while (size < total * 16 && size < 1 << 26) size <<= 1;
    this.mask = size - 1;
    this.bits = new Uint8Array(size >> 3);
    for (const t of texts) {
      for (let i = 0; i + 2 < t.length; i++) {
        const h = this.hash(t.charCodeAt(i), t.charCodeAt(i + 1), t.charCodeAt(i + 2));
        this.bits[h >> 3] = (this.bits[h >> 3] as number) | (1 << (h & 7));
      }
    }
  }
  private hash(a: number, b: number, c: number): number {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(c, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return h & this.mask;
  }
  /** False means the string certainly does not occur; true means it may. */
  mayContain(s: string): boolean {
    for (let i = 0; i + 2 < s.length; i++) {
      const h = this.hash(s.charCodeAt(i), s.charCodeAt(i + 1), s.charCodeAt(i + 2));
      if (((this.bits[h >> 3] as number) & (1 << (h & 7))) === 0) return false;
    }
    return true;
  }
}

export class FakeAllocator {
  private readonly byValue = new Map<string, string>();
  private readonly used = new Map<string, Set<number>>();
  /** For each category, the smallest n not yet used (so allocation never rewalks used numbers). */
  private readonly lowest = new Map<string, number>();
  private readonly aloneCache = new Map<string, boolean>();
  private readonly filter: TrigramFilter;

  constructor(
    private readonly ruleset: Ruleset,
    private readonly categories: Map<string, CategoryDecl>,
    private readonly inputTexts: string[],
    private readonly extraSurrogates: Map<string, string>,
    private readonly checks = { alone: true, inInput: true },
  ) {
    this.filter = new TrigramFilter(inputTexts);
  }

  private hitAlone(candidate: string): boolean {
    let r = this.aloneCache.get(candidate);
    if (r === undefined) {
      r = this.exactHit(candidate);
      this.aloneCache.set(candidate, r);
    }
    return r;
  }

  private exactHit(candidate: string): boolean {
    const plain = /^[\u0020-\u007e]*$/.test(candidate);
    const view = plain ? null : buildScanView(candidate);
    const text = view === null ? candidate : view.str;
    const pf = prefilterFor(this.ruleset.patternRules);
    const maybe = (pf.sensitive?.test(text) ?? false) || (pf.insensitive?.test(text) ?? false);
    const rest: Ruleset = maybe
      ? this.ruleset
      : { patternRules: [], termRules: this.ruleset.termRules, literals: this.ruleset.literals };
    const needTerms = rest.termRules.length > 0 || rest.literals.length > 0;
    if (!maybe && !needTerms) return false;
    return detect(rest, view ?? buildScanView(candidate), null).length > 0;
  }

  private occursInInput(candidate: string): boolean {
    if (candidate.length >= 3 && !this.filter.mayContain(candidate)) return false;
    return this.inputTexts.some((t) => t.includes(candidate));
  }

  /** The fake for a value, allocated on first sight. `sample` is the value's scan-view text. */
  allocate(
    category: string,
    variant: string | undefined,
    canonical: string,
    sample: string,
  ): string {
    const key = category + "\u0000" + canonical;
    const known = this.byValue.get(key);
    if (known !== undefined) return known;
    const surrogate =
      this.extraSurrogates.get(category) ?? this.categories.get(category)?.surrogate ?? "shape";
    if (surrogate === "mask") {
      this.byValue.set(key, "***");
      return "***";
    }
    let used = this.used.get(category);
    if (used === undefined) {
      used = new Set();
      this.used.set(category, used);
    }
    for (let n = this.lowest.get(category) ?? 1; ; n++) {
      if (used.has(n)) continue;
      // A template that runs out falls back to the shape-preserving form; a value with too few
      // digit positions to hold n falls back to a plain numbered marker.
      const fake =
        makeFake(surrogate, variant, n, sample) ?? shapeForm(sample, n) ?? `[redacted ${n}]`;
      if (this.checks.alone && this.hitAlone(fake)) continue;
      if (this.checks.inInput && this.occursInInput(fake)) continue;
      used.add(n);
      let low = this.lowest.get(category) ?? 1;
      while (used.has(low)) low++;
      this.lowest.set(category, low);
      this.byValue.set(key, fake);
      return fake;
    }
  }
}

/** True when some n from 1 to 100 gives a fake of this surrogate that no rule hits on its own. */
export function surrogateIsUsable(surrogate: string, ruleset: Ruleset): boolean {
  if (surrogate === "mask") return true;
  if (!surrogateIsValid(surrogate)) return false;
  // Value-dependent forms cannot be checked without a value; they are checked per request.
  if (surrogate === "shape" || surrogate === "postal") return true;
  for (let n = 1; n <= 100; n++) {
    const fake = makeFake(surrogate, undefined, n, "");
    if (fake === null) continue;
    if (detect(ruleset, buildScanView(fake), null).length === 0) return true;
  }
  return false;
}
