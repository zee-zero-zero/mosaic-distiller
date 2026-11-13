// Tests of the scan view and positions: invisible characters, NFKC, code-point positions
// (ENG-4, ENG-5, ENG-6, ENG-17, ENG-18).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildScanView, classifyInvisible } from "../src/text/scanview";
import { toCodePoints } from "../src/text/codepoints";
import { defaultEngine, distillText, smallEngine } from "./helpers";

const NONE = smallEngine([{ id: "never.matches", pattern: "zzzzzzzz" }]);
const cp = (s: string): number => Array.from(s).length;

const REMOVED: [string, string][] = [
  ["U+200B zero-width space", "​"],
  ["U+2060 word joiner", "⁠"],
  ["U+2061", "⁡"],
  ["U+2062", "⁢"],
  ["U+2063", "⁣"],
  ["U+2064", "⁤"],
  ["U+180E", "᠎"],
  ["U+00AD soft hyphen", "­"],
  ["U+FEFF inside a segment", "﻿"],
  ["U+202A", "‪"],
  ["U+202B", "‫"],
  ["U+202C", "‬"],
  ["U+202D", "‭"],
  ["U+202E right-to-left override", "‮"],
  ["U+2066", "⁦"],
  ["U+2067", "⁧"],
  ["U+2068", "⁨"],
  ["U+2069", "⁩"],
  ["U+FFF9", "￹"],
  ["U+FFFA", "￺"],
  ["U+FFFB", "￻"],
  ["a lone tag character U+E0041", "\u{e0041}"],
  ["U+E007F outside a sequence", "\u{e007f}"],
  ["U+E0100 variation selector", "\u{e0100}"],
  ["U+E01EF variation selector", "\u{e01ef}"],
  ["U+FE00 variation selector", "︀"],
  ["U+FE0D variation selector", "︍"],
];

const KEPT: [string, string, string][] = [
  ["a Persian zero-width non-joiner", "می‌خواهم", ""],
  ["an emoji zero-width joiner", "👨‍👩‍👧", ""],
  ["a leading byte-order mark", "﻿abc", ""],
  ["U+200E left-to-right mark", "a‎b", ""],
  ["U+200F right-to-left mark", "a‏b", ""],
  ["U+061C Arabic letter mark", "a؜b", ""],
  ["U+FE0E text variation selector", "a︎b", ""],
  ["U+FE0F emoji variation selector", "❤️", ""],
  ["the flag of Wales", "🏴\u{e0067}\u{e0062}\u{e0077}\u{e006c}\u{e0073}\u{e007f}", ""],
  ["the flag of Scotland", "🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}", ""],
];

describe("ENG-17 invisible characters: each removed character is deleted and reported once per run", () => {
  for (const [name, ch] of REMOVED) {
    it(name, () => {
      const r = distillText(NONE, `ab${ch}cd`);
      expect(r.segments[0].distillate).toBe("abcd");
      const f = r.findings.filter((x: any) => x.rule === "hidden.invisible");
      expect(f).toHaveLength(1);
      expect([f[0].start, f[0].end]).toEqual([2, 2 + cp(ch)]);
    });
  }

  it("U+200C and U+200D between two ASCII letters or digits are removed", () => {
    for (const ch of ["‌", "‍"]) {
      for (const [l, r] of [
        ["a", "b"],
        ["1", "2"],
        ["a", "2"],
      ]) {
        const out = distillText(NONE, `${l}${ch}${r}`);
        expect(out.segments[0].distillate).toBe(`${l}${r}`);
      }
    }
  });

  it("a run of several removed characters is one finding; a kept one splits the run", () => {
    const one = distillText(NONE, "a​​⁠b");
    expect(one.findings.map((f: any) => [f.start, f.end])).toEqual([[1, 4]]);
    const split = distillText(NONE, "a​‎​b");
    expect(split.findings.map((f: any) => [f.start, f.end])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(split.segments[0].distillate).toBe("a‎b");
  });

  it("a tag-character run that is not a closed emoji tag sequence is removed", () => {
    const r = distillText(NONE, "🏴\u{e0067}\u{e0062}x");
    expect(r.segments[0].distillate).toBe("🏴x");
  });
});

describe("ENG-17 invisible characters: each kept character is kept", () => {
  for (const [name, text] of KEPT) {
    it(name, () => {
      const r = distillText(NONE, text);
      expect(r.segments[0].distillate).toBe(text);
      expect(r.findings.filter((x: any) => x.rule === "hidden.invisible")).toHaveLength(0);
    });
  }

  it("a byte-order mark that is not at the start is removed, while one at the start is kept", () => {
    const r = distillText(NONE, "﻿a﻿b");
    expect(r.segments[0].distillate).toBe("﻿ab");
  });

  it("kept characters are still dropped from the scan view, so values around them are found", () => {
    const view = buildScanView("a‎b");
    expect(view.str).toBe("ab");
    expect(Array.from(view.origin)).toEqual([0, 2]);
  });
});

describe("ENG-4 values hidden by invisible characters are found, over their whole original range", () => {
  const engine = defaultEngine("agent");
  it("a zero-width space inside an e-mail address", () => {
    const text = "al​ice@northwind-mail.com";
    const r = distillText(engine, text);
    expect(r.removals).toHaveLength(1);
    expect([r.removals[0].start, r.removals[0].end]).toEqual([0, cp(text)]);
    expect(r.segments[0].distillate).toBe("person1@example.com");
  });
  it("a soft hyphen inside an IBAN", () => {
    const text = "GB82 WE­ST 1234 5698 7654 32";
    const r = distillText(engine, text);
    expect(r.removals.map((x: any) => x.category)).toEqual(["financial.iban"]);
    expect([r.removals[0].start, r.removals[0].end]).toEqual([0, cp(text)]);
    expect(r.segments[0].distillate).not.toContain("­");
  });
  it("a zero-width joiner inside 536-22-8914", () => {
    const text = "536‍-22-8914";
    const r = distillText(engine, text);
    expect(r.removals.map((x: any) => x.category)).toEqual(["gov_id.us_ssn"]);
    expect([r.removals[0].start, r.removals[0].end]).toEqual([0, cp(text)]);
    expect(r.segments[0].distillate).toBe("000-00-0001");
  });
  it("a value in full-width digits is found by its NFKC form and replaced over its original range", () => {
    const text = "x ５３６-２２-８９１４ y";
    const r = distillText(engine, text);
    expect(r.removals[0].category).toBe("gov_id.us_ssn");
    expect(r.segments[0].distillate).toBe("x 000-00-0001 y");
  });
});

describe("ENG-5 positions map back exactly", () => {
  const INVISIBLE = ["​", "⁠", "­", "‍", "‎", "﻿", "‮", "‌"];
  const value = "536-22-8914";
  it("random invisible characters inserted into a planted value: the removal covers the value and the inserted characters", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 1, max: value.length - 1 }), fc.constantFrom(...INVISIBLE)),
          { minLength: 1, maxLength: 6 },
        ),
        fc.string({ unit: fc.constantFrom(..."abc xyz.,"), maxLength: 8 }),
        (inserts, prefix) => {
          let v = value;
          // insert from the right so earlier indices stay valid
          const sorted = [...inserts].sort((a, b) => b[0] - a[0]);
          for (const [i, ch] of sorted) v = v.slice(0, i) + ch + v.slice(i);
          const text = `${prefix} ${v} end`;
          const r = distillText(defaultEngine("agent"), text);
          expect(r.removals).toHaveLength(1);
          const start = cp(`${prefix} `);
          expect([r.removals[0].start, r.removals[0].end]).toEqual([start, start + cp(v)]);
          expect(r.segments[0].distillate).toBe(`${prefix} 000-00-0001 end`);
        },
      ),
      { seed: 5, numRuns: 150 },
    );
  });
  it("the scan view's map covers removed characters", () => {
    const view = buildScanView("a​​b");
    expect(Array.from(view.origin)).toEqual([0, 3]);
    expect(view.runs).toEqual([{ start: 1, end: 3 }]);
  });
});

describe("ENG-6 positions are code points", () => {
  const prefixes = [
    "😀",
    "🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}",
    "漢",
    "😀🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}漢 ",
  ];
  for (const prefix of prefixes) {
    it(`before a value: ${JSON.stringify(prefix)}`, () => {
      const email = "jane.doe@northwind-mail.com";
      const text = `${prefix} ${email}`;
      const r = distillText(defaultEngine("agent"), text);
      expect(r.removals[0].start).toBe(cp(prefix) + 1);
      expect(r.removals[0].end).toBe(cp(prefix) + 1 + cp(email));
      expect(r.segments[0].distillate).toBe(`${prefix} person1@example.com`);
      // The flag survives in the distillate.
      expect(r.segments[0].distillate.startsWith(prefix)).toBe(true);
    });
  }
  it("a lone surrogate is one code point (U+FFFD), not two", () => {
    const { cps, lone } = toCodePoints("a\ud800b");
    expect(lone).toBe(true);
    expect(Array.from(cps)).toEqual([0x61, 0xfffd, 0x62]);
  });
});

describe("ENG-18 the distillate is not normalised", () => {
  it("full-width digits and a ligature outside any value are unchanged", () => {
    const text = "ﬁle １２３ café ½";
    const r = distillText(defaultEngine("agent"), text);
    expect(r.segments[0].distillate).toBe(text);
    expect(r.removals).toEqual([]);
  });
  it("the scan view is normalised: a ligature expands and full-width digits become ASCII", () => {
    const v = buildScanView("ﬁ１");
    expect(v.str).toBe("fi1");
    expect(Array.from(v.origin)).toEqual([0, 0, 1]);
  });
  it("classifyInvisible marks only invisible characters", () => {
    const k = classifyInvisible(Uint32Array.from([0x61, 0x200b, 0x62]));
    expect(Array.from(k)).toEqual([0, 1, 0]);
  });
});
