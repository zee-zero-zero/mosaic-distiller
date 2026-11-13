// Provides the segment pool (§5.3): about 200 segments generated from a fixed seed, each with
// sensitive values planted at known positions, so the expected spans are known without asking the
// engine. Members cover every redactable category, mixed categories, no values, adjacent values,
// values at the start and end of a segment, text in non-Latin scripts, invisible characters
// inside values, and dictionary terms. Values come from the examples of §3 (read from the
// conformance cases), or are generated with checksums computed here, or are synthetic secrets
// built with a repeating filler so that no scanner takes them for live keys.
import { readFileSync } from "node:fs";
import { shapeForm } from "../../src/fakes";
import { ROOT } from "../helpers";

export interface Planted {
  category: string;
  variant?: string;
  /** Code-point range of the value inside the member's text. */
  start: number;
  end: number;
}

export interface PoolMember {
  id: string;
  /** What this member exercises; the guard (ENG-2) checks that every kind is present. */
  kinds: string[];
  text: string;
  planted: Planted[];
}

export const POOL_KINDS = [
  "single",
  "mixed",
  "none",
  "adjacent",
  "start",
  "end",
  "non-latin",
  "invisible",
  "dictionary",
] as const;

/** The caller's dictionary that every pool request carries. */
export const POOL_DICTIONARY = {
  name: "names",
  template: "Name {n}",
  terms: ["Zora Quill", "Brandt Okafor", "Ilse Varga", "Tomas Wyrd", "Ștefan Qvist", "Мила Крок"],
};

// ---- deterministic randomness ----------------------------------------------------------------

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(xs: readonly T[], seed: number): T[] {
  const r = rng(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const cpLen = (s: string): number => Array.from(s).length;

// ---- value generators ------------------------------------------------------------------------

interface Value {
  category: string;
  variant?: string;
  text: string;
  /** The part of `text` that must be replaced, in code points. */
  start: number;
  end: number;
}

const whole = (category: string, text: string, variant?: string): Value => ({
  category,
  text,
  start: 0,
  end: cpLen(text),
  ...(variant === undefined ? {} : { variant }),
});

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}
function digits(r: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(r() * 10);
  return s;
}
function chars(r: () => number, alphabet: string, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}
function luhnDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = body.charCodeAt(body.length - 1 - i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

const CONSONANTS = "bdfghjklqrvwxz";
const FILLER_WORDS = [
  "alpha",
  "bravo",
  "delta",
  "ember",
  "forge",
  "grove",
  "harbor",
  "island",
  "jungle",
  "kernel",
  "lantern",
  "meadow",
  "nectar",
  "orchid",
  "pebble",
  "quartz",
  "ripple",
  "summit",
  "timber",
  "umber",
];

/** A synthetic secret body: a prefix, then a repeating filler (so no scanner takes it for live). */
function filler(r: () => number, n: number): string {
  const unit = chars(r, "abcdefghij", 3 + Math.floor(r() * 3));
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
}

export function generatedValues(r: () => number): Value[] {
  const out: Value[] = [];
  for (let i = 0; i < 6; i++) {
    out.push(
      whole(
        "contact.email",
        `${chars(r, CONSONANTS, 4 + (i % 4))}@${chars(r, CONSONANTS, 3)}-${chars(r, CONSONANTS, 3)}.net`,
      ),
    );
  }
  for (let i = 0; i < 4; i++) {
    out.push(
      whole(
        "network.ipv4",
        `${52 + Math.floor(r() * 40)}.${1 + Math.floor(r() * 250)}.${1 + Math.floor(r() * 250)}.${1 + Math.floor(r() * 250)}`,
      ),
    );
  }
  for (let i = 0; i < 6; i++) {
    const h = (n: number): string => chars(r, "abcdef56789", n);
    out.push(whole("network.ipv6", `2a${h(2)}:${h(4)}:${h(4)}:${h(3)}::${h(4)}`));
  }
  out.push(whole("network.ipv4", "10.20.30.40", "private"));
  out.push(whole("network.ipv4", "127.0.0.1", "loopback"));
  for (let i = 0; i < 4; i++) {
    const area = 200 + Math.floor(r() * 99) + 10;
    out.push(whole("contact.phone", `(${area}) ${300 + Math.floor(r() * 600)}-${digits(r, 4)}`));
  }
  for (let i = 0; i < 4; i++) {
    const area = 100 + Math.floor(r() * 500);
    const group = 10 + Math.floor(r() * 80);
    const serial = 1000 + Math.floor(r() * 8999);
    if (area === 666 || area === 0) continue;
    out.push(whole("gov_id.us_ssn", `${area}-${group}-${serial}`));
  }
  const nino = ["AB", "CE", "JK", "LM", "PR", "SW", "XY", "EH", "MA", "TX"];
  for (let i = 0; i < 4; i++) {
    out.push(
      whole(
        "gov_id.gb_nino",
        `${pick(r, nino)} ${digits(r, 2)} ${digits(r, 2)} ${digits(r, 2)} ${pick(r, ["A", "B", "C", "D"])}`,
      ),
    );
  }
  const ALPHA = "0123456789ABCDEFGHJKLMNPQRTUWXY";
  const W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  for (let i = 0; i < 3; i++) {
    const body = digits(r, 8) + chars(r, "ABCDEFGHJKLMNPQRTUWXY", 3) + chars(r, ALPHA, 6);
    let sum = 0;
    for (let k = 0; k < 17; k++) sum += ALPHA.indexOf(body[k] as string) * (W[k] as number);
    out.push(whole("org_id.cn_uscc", body + ALPHA[(31 - (sum % 31)) % 31]));
  }
  for (let i = 0; i < 3; i++) {
    const body = String(1 + Math.floor(r() * 9)) + digits(r, 7);
    out.push(
      whole(
        "org_id.ca_bn",
        `${body}${luhnDigit(body)} R${pick(r, ["C", "T", "P"])} ${String(2000 + Math.floor(r() * 7000))}`,
      ),
    );
  }
  for (let i = 0; i < 3; i++) {
    const date = `${50 + Math.floor(r() * 49)}${String(1 + Math.floor(r() * 12)).padStart(2, "0")}${10 + Math.floor(r() * 19)}`;
    const body = date + String(1 + Math.floor(r() * 9)) + digits(r, 2);
    out.push(whole("gov_id.se_pnr", `${body.slice(0, 6)}-${body.slice(6)}${luhnDigit(body)}`));
  }
  for (let i = 0; i < 4; i++) {
    const body = "4" + digits(r, 14);
    const n = body + luhnDigit(body);
    out.push(
      whole(
        "financial.payment_card",
        `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8, 12)} ${n.slice(12)}`,
      ),
    );
  }
  const token = (): string => chars(r, "abcdefghijklmnopqrstuvwxyz0123456789", 12);
  out.push(whole("secret.vendor_key", "ghp_" + filler(r, 36)));
  out.push(whole("secret.vendor_key", "AKIA" + filler(r, 16).toUpperCase()));
  out.push(whole("secret.vendor_key", "sk-" + filler(r, 40)));
  out.push(whole("secret.vendor_key", "AIza" + filler(r, 35)));
  out.push(whole("secret.vendor_key", "npm_" + filler(r, 36)));
  out.push(whole("secret.jwt", `eyJ${filler(r, 20)}.eyJ${filler(r, 24)}.${filler(r, 30)}`));
  out.push(
    whole(
      "secret.private_key",
      `-----BEGIN PRIVATE KEY-----\n${filler(r, 60)}\n${filler(r, 60)}\n-----END PRIVATE KEY-----`,
    ),
  );
  const keyed = `password=${token()}`;
  out.push({ category: "secret.keyed_value", text: keyed, start: 9, end: cpLen(keyed) });
  const q = `https://files.qzx-wvk.net/get?sig=${token()}`;
  out.push({
    category: "secret.query_param",
    text: q,
    start: q.indexOf("sig=") + 4,
    end: cpLen(q),
  });
  const u = `https://${chars(r, "abcdefgh", 5)}:${token()}@fileserver/`;
  out.push({ category: "secret.url_credential", text: u, start: 8, end: u.indexOf("@") });
  const hdr = `Authorization: Basic ${token()}${token()}`;
  out.push({ category: "secret.auth_header", text: hdr, start: 15, end: cpLen(hdr) });
  const bearer = `Bearer ${token()}${token()}`;
  out.push({ category: "secret.bearer", text: bearer, start: 7, end: cpLen(bearer) });
  const extra = `x-access-token:${token()}`;
  out.push({ category: "secret.extraheader", text: extra, start: 15, end: cpLen(extra) });
  return out;
}

interface RuleCase {
  rule: string;
  text: string;
  expect: string;
  category?: string;
  variant?: string;
}

/**
 * A 4-character substring carries content when it holds a letter or digit other than the fake's
 * own filler characters 0, X and x. A run of separators (`<<<<` in a machine-readable zone) or of
 * filler is shape, not content, and a shape-preserving fake keeps it (§2.8).
 */
export function carriesContent(gram: string): boolean {
  return Array.from(gram).some((c) => /[\p{L}\p{N}]/u.test(c) && !"0Xx".includes(c));
}

/** The 4-character substrings no value may share with the fields of a record (ENG-3). */
export function forbiddenFourGrams(): Set<string> {
  const pack = JSON.parse(readFileSync(ROOT + "rulepacks/default.json", "utf8")) as {
    categories: Record<string, unknown>;
    rules: { id: string; variant?: string }[];
  };
  const fields = [
    ...Object.keys(pack.categories),
    ...pack.rules.map((x) => x.id),
    ...pack.rules.flatMap((x) => (x.variant === undefined ? [] : [x.variant])),
    "person1@example.com person2@example.com (202) 555-01 192.0.2. 198.51.100. 203.0.113. 2001:db8:: 00:00:5e:00:53:",
    "Name 1 Name 2 Name 3 ***",
    "p001 p002",
  ].join("\n");
  const out = new Set<string>();
  const cps = Array.from(fields);
  for (let i = 0; i + 4 <= cps.length; i++) {
    const g = cps.slice(i, i + 4).join("");
    if (carriesContent(g)) out.add(g);
  }
  return out;
}

function gramsOf(text: string): Set<string> {
  const cps = Array.from(text);
  const out = new Set<string>();
  for (let i = 0; i + 4 <= cps.length; i++) {
    const g = cps.slice(i, i + 4).join("");
    if (carriesContent(g)) out.add(g);
  }
  return out;
}

/**
 * True when the value shares a content-carrying 4-character substring with a field a record may
 * hold: a rule id, a category, a fixed fake, or the value's own shape-preserving fake with the
 * first few numbers written into it (ENG-3 would otherwise fail by coincidence, not by a leak).
 */
function hasForbidden(v: Value, forbidden: Set<string>): boolean {
  // Only the replaced part of a value is removed text; a keyword kept in place (`token=`) is not.
  const text = Array.from(v.text).slice(v.start, v.end).join("");
  const own = gramsOf(text);
  for (const g of own) if (forbidden.has(g)) return true;
  for (let n = 1; n <= 4; n++) {
    for (const f of [shapeForm(text, n), shapeForm(text, n, "D")]) {
      if (f === null) continue;
      for (const g of gramsOf(f)) if (own.has(g)) return true;
    }
  }
  return false;
}

/** Every value the pool may plant: the spec's examples, then the generated ones. */
export function allValues(seed = 20261113): Value[] {
  const r = rng(seed);
  const forbidden = forbiddenFourGrams();
  const cases = readFileSync(ROOT + "conformance/rules.jsonl", "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RuleCase);
  const fromSpec: Value[] = [];
  for (const c of cases) {
    if (c.expect !== "hit" || c.category === undefined) continue;
    if (
      c.category.startsWith("secret.") ||
      c.category.startsWith("inject.") ||
      c.category.startsWith("hidden.")
    )
      continue;
    if (c.category === "contact.email") continue;
    const v = whole(c.category, c.text, c.variant);
    if (hasForbidden(v, forbidden)) continue;
    fromSpec.push(v);
  }
  const generated = generatedValues(r).filter((v) => !hasForbidden(v, forbidden));
  return [...fromSpec, ...generated];
}

// ---- assembling members ----------------------------------------------------------------------

const SCRIPTS = [
  "Привет, друзья",
  "漢字とかな",
  "مرحبا بكم",
  "สวัสดีครับ",
  "Γειά σου κόσμε",
  "नमस्ते दुनिया",
];
const INVISIBLE = ["​", "⁠", "­", "‮", "﻿", "‌"];

class Builder {
  text = "";
  planted: Planted[] = [];
  private len = 0;
  raw(s: string): void {
    this.text += s;
    this.len += cpLen(s);
  }
  value(v: Value): void {
    const p: Planted = { category: v.category, start: this.len + v.start, end: this.len + v.end };
    if (v.variant !== undefined) p.variant = v.variant;
    this.planted.push(p);
    this.raw(v.text);
  }
}

/** Puts an invisible character between two characters inside the replaced part of a value. */
function withInvisible(v: Value, r: () => number): Value {
  const cps = Array.from(v.text);
  const lo = v.start + 1;
  const hi = v.end - 1;
  if (hi <= lo) return v;
  const count = 1 + Math.floor(r() * 2);
  let end = v.end;
  for (let k = 0; k < count; k++) {
    const at = lo + Math.floor(r() * (hi - lo + 1));
    // Not before the first or after the last character of the replaced part.
    cps.splice(Math.min(at, end - 1), 0, pick(r, INVISIBLE));
    end++;
  }
  return { ...v, text: cps.join(""), end };
}

export function generatePool(seed = 20261113): PoolMember[] {
  const r = rng(seed);
  const values = allValues(seed);
  const words = (n: number): string =>
    Array.from({ length: n }, () => pick(r, FILLER_WORDS)).join(" ");
  const members: PoolMember[] = [];
  const add = (kinds: string[], build: (b: Builder) => void): void => {
    const b = new Builder();
    build(b);
    members.push({
      id: `p${String(members.length + 1).padStart(3, "0")}`,
      kinds,
      text: b.text,
      planted: b.planted,
    });
  };
  // One member per value: the value in a sentence.
  for (const v of values) {
    add(["single"], (b) => {
      b.raw(`${words(2)} `);
      b.value(v);
      b.raw(` ${words(2)}.`);
    });
  }
  // Values at the very start and the very end of a segment.
  for (let i = 0; i < 6; i++) {
    const v = pick(r, values);
    add(["start"], (b) => {
      b.value(v);
      b.raw(` ${words(3)}`);
    });
    const w = pick(r, values);
    add(["end"], (b) => {
      b.raw(`${words(3)} `);
      b.value(w);
    });
  }
  // Several categories mixed, on several lines.
  for (let i = 0; i < 20; i++) {
    add(["mixed"], (b) => {
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        b.raw(`${words(2)}`);
        b.raw(k % 2 === 0 ? ", " : "\n");
        b.value(pick(r, values));
        b.raw(k % 2 === 0 ? " " : "\n");
      }
      b.raw(words(2));
    });
  }
  // Values adjacent to each other, one separator apart (two numbers one space apart would be one
  // longer run of digits, which is not what a person means by two values).
  for (let i = 0; i < 12; i++) {
    add(["adjacent"], (b) => {
      b.value(pick(r, values));
      b.raw(" | ");
      b.value(pick(r, values));
      b.raw(" | ");
      b.value(pick(r, values));
    });
  }
  // Text in non-Latin scripts around values.
  for (let i = 0; i < 12; i++) {
    add(["non-latin"], (b) => {
      b.raw(`${pick(r, SCRIPTS)} `);
      b.value(pick(r, values));
      b.raw(` ${pick(r, SCRIPTS)}`);
    });
  }
  // Invisible characters inside values.
  for (let i = 0; i < 20; i++) {
    const v = withInvisible(pick(r, values), r);
    add(["invisible"], (b) => {
      b.raw(`${words(2)} `);
      b.value(v);
      b.raw(` ${words(1)}`);
    });
  }
  // The caller's dictionary terms.
  for (let i = 0; i < 6; i++) {
    const term = POOL_DICTIONARY.terms[i] as string;
    add(["dictionary"], (b) => {
      b.raw(`${words(2)} `);
      const t = i % 2 === 0 ? term : term.toUpperCase();
      b.value({ category: "dictionary.names", text: t, start: 0, end: cpLen(t) });
      b.raw(` ${words(2)}`);
    });
  }
  // No values at all.
  const harmless = [
    "see v2.7.2 for notes",
    "icon@2x.png is an image",
    "the object 1.3.6.1.4.1 is a tree",
    "meet on 2026-11-11 at noon",
    "std::vector holds items",
    "ref #4111 and 1234 5678",
  ];
  for (const h of harmless) add(["none"], (b) => b.raw(`${words(2)} ${h} ${words(2)}`));
  for (let i = 0; i < 6; i++) add(["none"], (b) => b.raw(words(8 + i)));
  return members;
}

/** A request for one member, carrying the pool's dictionary (terms optionally shuffled). */
export function requestFor(m: PoolMember, shuffleSeed?: number): any {
  const terms =
    shuffleSeed === undefined
      ? POOL_DICTIONARY.terms
      : seededShuffle(POOL_DICTIONARY.terms, shuffleSeed);
  return {
    segments: [{ id: m.id, text: m.text }],
    dictionaries: [{ name: POOL_DICTIONARY.name, template: POOL_DICTIONARY.template, terms }],
  };
}
