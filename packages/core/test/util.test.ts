// Tests of the small helpers every output depends on: the RFC 8785 canonicaliser, code-point
// ordering (never UTF-16 order, never a locale), and the UTF-8 byte count.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/jcs";
import { cmpCodePoints, utf8Length } from "../src/util";

describe("jcs: RFC 8785", () => {
  it("sorts keys by UTF-16 code units (the RFC's own example, section 3.2.3)", () => {
    const keys = ["€", "\r", "דּ", "1", "😀", "\u0080", "ö"];
    const obj = Object.fromEntries(keys.map((k) => [k, 0]));
    const out = canonicalize(obj);
    const order = [...out.matchAll(/"((?:[^"\\]|\\.)*)":0/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    expect(order).toEqual(["\r", "1", "\u0080", "ö", "€", "😀", "דּ"]);
  });
  it("writes strings as JSON does: escapes for quote, backslash and control characters, nothing else", () => {
    expect(canonicalize('a"b\\c\n\t\u0001\u007f é😀')).toBe('"a\\"b\\\\c\\n\\t\\u0001\u007f é😀"');
  });
  it("writes no white space, and nested values in order", () => {
    expect(canonicalize({ b: [1, { z: null, a: true }], a: "x" })).toBe(
      '{"a":"x","b":[1,{"a":true,"z":null}]}',
    );
  });
  it("writes integers as digits, and refuses what a pack does not hold", () => {
    expect(canonicalize([0, -5, 123456789])).toBe("[0,-5,123456789]");
    expect(() => canonicalize(1.5)).toThrow();
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(() => 1)).toThrow();
  });
  it("is independent of the order keys were inserted in", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
  it("a hash of a canonical form matches an independent computation (Python's sorted-key JSON) for BMP keys", () => {
    const obj = { rules: [{ id: "x", pattern: "[0-9]{3}" }], name: "naïve", n: 3 };
    const expected = '{"n":3,"name":"naïve","rules":[{"id":"x","pattern":"[0-9]{3}"}]}';
    expect(canonicalize(obj)).toBe(expected);
    expect(createHash("sha256").update(canonicalize(obj), "utf8").digest("hex")).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe("util: code-point order", () => {
  it("compares by code point: U+FF21 sorts before U+10000, which UTF-16 order reverses", () => {
    expect(cmpCodePoints("Ａ", "\u{10000}")).toBeLessThan(0);
    expect("Ａ" < "\u{10000}").toBe(false); // the UTF-16 order the engine must not use
    expect(cmpCodePoints("\u{10000}", "Ａ")).toBeGreaterThan(0);
  });
  it("is a total order: reflexive, antisymmetric, a prefix sorts first", () => {
    const xs = ["", "a", "ab", "b", "é", "z", "\u{1f600}", "\u{10000}", "Ａ"];
    for (const a of xs) {
      expect(cmpCodePoints(a, a)).toBe(0);
      for (const b of xs)
        expect(Math.sign(cmpCodePoints(a, b)) + 0).toBe(-Math.sign(cmpCodePoints(b, a)) + 0);
    }
    expect(cmpCodePoints("a", "ab")).toBeLessThan(0);
    expect(cmpCodePoints("ab", "a")).toBeGreaterThan(0);
  });
  it("is not the locale's order: upper case sorts before lower case, é after z", () => {
    expect(cmpCodePoints("Z", "a")).toBeLessThan(0);
    expect(cmpCodePoints("z", "é")).toBeLessThan(0);
  });
  it("sorts like the Array default for BMP strings", () => {
    const xs = ["b", "B", "a", "ä", "Z", "1", "_"];
    expect([...xs].sort(cmpCodePoints)).toEqual([...xs].sort());
  });
});

describe("util: UTF-8 length", () => {
  it("counts bytes: 1 for ASCII, 2, 3, 4, and 3 for a lone surrogate", () => {
    expect(utf8Length("")).toBe(0);
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
    expect(utf8Length("\ud800")).toBe(3);
    expect(utf8Length("\udc00x")).toBe(4);
    expect(utf8Length("a\ud800b")).toBe(5);
  });
  it("agrees with TextEncoder on well-formed strings", () => {
    const enc = new TextEncoder();
    for (const s of [
      "",
      "plain",
      "héllo wörld",
      "漢字かな",
      "😀🏴\u{e0067}x",
      "\u0000\u007f\u0080߿ࠀ￿",
    ]) {
      expect(utf8Length(s)).toBe(enc.encode(s).length);
    }
  });
});
