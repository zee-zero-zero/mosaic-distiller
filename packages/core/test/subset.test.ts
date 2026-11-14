// Tests of the pattern subset parser and the compiler (ENG-23, the pattern part; step 1.3).
import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/pattern/compile";
import { parsePattern } from "../src/pattern/subset";
import { RulePackError } from "../src/schema";
import { readJson } from "./helpers";

function refused(pattern: string): string {
  try {
    parsePattern(pattern);
  } catch (e) {
    expect(e).toBeInstanceOf(RulePackError);
    return (e as RulePackError).code;
  }
  return "ACCEPTED";
}

describe("ENG-23 subset: constructs the subset refuses", () => {
  const bad: [string, string][] = [
    ["positive lookahead", "(?=a)b"],
    ["negative lookahead", "a(?!b)"],
    ["lookbehind", "(?<=a)b"],
    ["negative lookbehind", "(?<!a)b"],
    ["named group", "(?<n>a)"],
    ["inline flag", "(?i)abc"],
    ["backreference", "(a)\\1"],
    ["\\d", "\\d{3}"],
    ["\\w", "\\w{3}"],
    ["\\s", "a\\s{1,2}"],
    ["\\b", "\\bword"],
    ["\\B", "a\\B"],
    ["\\D", "\\D{2}"],
    ["\\d hidden in a class", "[\\d]{3}"],
    ["\\w hidden in a class with a range", "[a-z\\w]{3}"],
    ["star", "a*"],
    ["plus", "a+"],
    ["star on a group", "(?:ab)*"],
    ["unbounded {m,}", "a{1,}"],
    ["unbounded {2,}", "[0-9]{2,}"],
    ["{,n}", "a{,3}"],
    ["descending range", "a{3,2}"],
    ["zero repeat", "a{0}"],
    ["repeat too large", "a{1,70000}"],
    ["lazy after a bound", "a{1,2}?"],
    ["lazy after ?", "a??"],
    ["stacked quantifiers", "a{1,2}{3}"],
    ["possessive", "a{1,2}+"],
    ["two capture groups", "(a)(b)"],
    ["nested capture groups", "((a))"],
    ["captures in alternatives", "(a)|(b)"],
    ["repeated capture group", "([a-z]{1,9}){1,9}"],
    ["repeated group, same characters inside", "(?:[a-z]{1,9}){1,9}"],
    ["repeated group after a repetition of the same characters", "[a-z]{1,9}(?:[a-z]{1,3}){2}"],
    ["repeated group nested in a repeated group", "(?:(?:a{1,3}){1,3}b){1,3}"],
    ["short alternative first", "N|NW"],
    ["short alternative first, with classes", "[NS]|N[WE]"],
    ["short alternative first in a terminal group", "x(?:N|NW)"],
    ["wildcard", "a.b"],
    ["unicode property", "\\p{L}{3}"],
    ["POSIX class", "[[:alpha:]]{3}"],
    ["empty alternative", "a|"],
    ["empty group", "()"],
    ["empty non-capturing group", "(?:)"],
    ["empty pattern", ""],
    ["empty class", "[]"],
    ["descending class range", "[z-a]"],
    ["hex escape", "\\x41"],
    ["unicode escape", "\\u0041"],
    ["escaped letter", "\\q"],
    ["unclosed group", "(a"],
    ["unclosed class", "[a"],
    ["stray close paren", "a)"],
    ["stray close bracket", "a]"],
    ["stray close brace", "a}"],
    ["lone open brace", "a{"],
    ["quantifier with nothing before", "{1,2}"],
    ["quantifier on an anchor", "^{1,2}a"],
    ["double star", "a**"],
    ["trailing backslash", "a\\"],
    ["escaped hyphen outside a class", "a\\-b"],
  ];
  for (const [name, pattern] of bad) {
    it(`${name}: ${pattern}`, () => {
      expect(refused(pattern)).toBe("PACK_PATTERN_SUBSET");
    });
  }
});

describe("ENG-23 subset: constructs the subset accepts", () => {
  const good = [
    "NW|N",
    "(?:\\.[0-9]{1,3}){3}",
    "[A-Z]{3}",
    "〒[ ]?[0-9]{3}-[0-9]{4}",
    "(a)",
    "[a-]",
    "[-a]",
    "x{2}",
    "[^/ \\t\\r\\n@'\"<>]{1,5}",
    "\\.",
    "a\\/b",
    "[\\-a]",
    "^abc$",
    "x(?:sig|signature)=",
    "a{1,2}b?",
    "(?:ab|cd){1,3}",
    "[0-9]{4}(?:[ -][0-9]{4}){3}|[0-9]{4}[ -][0-9]{6}[ -][0-9]{5}|[0-9]{4}[ -][0-9]{6}[ -][0-9]{4}|[0-9]{13,19}",
    "(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?",
    "[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}",
    "\\(\\)\\[\\]\\{\\}\\|\\*\\+\\?\\^\\$\\\\",
  ];
  for (const pattern of good) {
    it(`accepts ${pattern}`, () => {
      expect(refused(pattern)).toBe("ACCEPTED");
    });
  }

  it("accepts every pattern of the default rule pack", () => {
    const pack = readJson("rulepacks/default.json") as {
      rules: { id: string; kind: string; pattern?: string }[];
    };
    let n = 0;
    for (const r of pack.rules) {
      if (r.kind !== "pattern") continue;
      expect(refused(r.pattern as string), r.id).toBe("ACCEPTED");
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });

  it("reports the capture group count and the anchors", () => {
    const p = parsePattern("^(a)[^$]$");
    expect(p.groups).toBe(1);
    expect(p.anchors.map((a) => a.char)).toEqual(["^", "$"]);
  });
});

describe("ENG-23 compile: flags and the m rewrite", () => {
  it("compiles with u and g, adding i and d on request", () => {
    expect(compilePattern("a(b)", "i").re.flags).toBe("dgiu");
    expect(compilePattern("ab", "").re.flags).toBe("gu");
  });

  it("never passes the m flag to JavaScript", () => {
    expect(compilePattern("^a$", "m").re.flags).not.toContain("m");
  });

  it("^ under m matches after U+000A only", () => {
    const re = compilePattern("^x", "m").re;
    const hit = (s: string): boolean => {
      re.lastIndex = 0;
      return re.test(s);
    };
    expect(hit("a\nx")).toBe(true);
    expect(hit("a\r\nx")).toBe(true);
    expect(hit("a\rx")).toBe(false);
    expect(hit("a x")).toBe(false);
    expect(hit("a x")).toBe(false);
    expect(hit("xa")).toBe(true);
  });

  it("$ under m matches before U+000A only", () => {
    const re = compilePattern("x$", "m").re;
    const hit = (s: string): boolean => {
      re.lastIndex = 0;
      return re.test(s);
    };
    expect(hit("x\na")).toBe(true);
    expect(hit("x\ra")).toBe(false);
    expect(hit("x a")).toBe(false);
    expect(hit("ax")).toBe(true);
  });

  it("without m, ^ matches only at the start of the segment", () => {
    const re = compilePattern("^x", "").re;
    re.lastIndex = 1;
    expect(re.test("a\nx")).toBe(false);
  });

  it("a negated class never matches half of a surrogate pair (the u flag)", () => {
    const re = compilePattern("[^a]", "").re;
    const m = re.exec("😀");
    expect(m?.[0]).toBe("😀");
  });
});
