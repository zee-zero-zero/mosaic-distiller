// Tests of the scan, the edges, the line-start flag and the counters (ENG-11, ENG-12, ENG-13,
// ENG-22), on small test packs so each mechanism is tested directly.
import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/pattern/compile";
import { edgeAccepts } from "../src/pattern/edges";
import { scanPatternRule } from "../src/pattern/scan";
import { buildScanView } from "../src/text/scanview";
import { defaultEngine, distillText, smallEngine } from "./helpers";

const cps = (s: string): Uint32Array =>
  Uint32Array.from(Array.from(s, (c) => c.codePointAt(0) as number));

describe("ENG-11 edges: direct", () => {
  const t = cps("a536-22-8914b");
  it("word rejects a word character before or after", () => {
    expect(edgeAccepts("word", t, 1, 12)).toBe(false);
    expect(edgeAccepts("word", cps(" x "), 1, 2)).toBe(true);
    expect(edgeAccepts("word", cps("_x"), 1, 2)).toBe(false);
    expect(edgeAccepts("word", cps("x_"), 0, 1)).toBe(false);
    expect(edgeAccepts("word", cps("-x-"), 1, 2)).toBe(true);
  });
  it("numeric also rejects a dot or hyphen next to a digit", () => {
    expect(edgeAccepts("numeric", cps("1.2.3.4.5"), 2, 7)).toBe(false);
    expect(edgeAccepts("numeric", cps("1-123"), 2, 5)).toBe(false);
    expect(edgeAccepts("numeric", cps("123-4"), 0, 3)).toBe(false);
    expect(edgeAccepts("numeric", cps("a.123"), 2, 5)).toBe(true);
    expect(edgeAccepts("numeric", cps("123.x"), 0, 3)).toBe(true);
    expect(edgeAccepts("numeric", cps("123."), 0, 3)).toBe(true);
    expect(edgeAccepts("numeric", cps(".123"), 1, 4)).toBe(true);
  });
  it("word_before checks only the character before, and accepts a hyphen only as a non-hit", () => {
    expect(edgeAccepts("word_before", cps("ab"), 1, 2)).toBe(false);
    expect(edgeAccepts("word_before", cps("-b"), 1, 2)).toBe(false);
    expect(edgeAccepts("word_before", cps(" b"), 1, 2)).toBe(true);
    expect(edgeAccepts("word_before", cps("bc"), 0, 1)).toBe(true);
  });
  it("word_colon is word, and also rejects a colon before or after", () => {
    expect(edgeAccepts("word_colon", cps(":ab"), 1, 3)).toBe(false);
    expect(edgeAccepts("word_colon", cps("ab:"), 0, 2)).toBe(false);
    expect(edgeAccepts("word_colon", cps("xab"), 1, 3)).toBe(false);
    expect(edgeAccepts("word_colon", cps(" ab "), 1, 3)).toBe(true);
    expect(edgeAccepts("word_colon", cps("ab"), 0, 2)).toBe(true);
  });
  it("none never rejects", () => {
    expect(edgeAccepts("none", cps("aab"), 1, 2)).toBe(true);
  });
});

describe("ENG-11 edges: through the default pack", () => {
  const engine = defaultEngine("agent");
  const key = "ghp_" + "abcdefghij".repeat(3) + "abcdef";
  const cases: [string, string][] = [
    ["an SSN inside a longer hyphenated number", "1-536-22-8914-2"],
    ["an SSN glued to a word character", "x536-22-8914"],
    ["a GitHub token glued to _x on its right", `${key}_x`],
    ["an object identifier is not an IPv4 address", "1.3.6.1.4.1"],
    ["an image file name is not an e-mail address", "icon@2x.png"],
  ];
  for (const [name, text] of cases) {
    it(name, () => {
      const r = distillText(engine, text);
      expect(r.removals).toEqual([]);
      expect(r.segments[0].distillate).toBe(text);
    });
  }
  it("the same shapes alone are hits (the edge check is what rejected them)", () => {
    expect(distillText(engine, "536-22-8914").removals).toHaveLength(1);
    expect(distillText(engine, key).removals).toHaveLength(1);
    expect(distillText(engine, "52.94.236.248").removals).toHaveLength(1);
  });
  it("a rejected edge is counted as rejected_edge", () => {
    const r = distillText(engine, "1-536-22-8914-2");
    expect(r.provenance.counters["gov_id.us_ssn"]).toMatchObject({
      candidates: 1,
      rejected_edge: 1,
      fired: 0,
    });
  });
});

describe("ENG-12 the scan restarts one code point after a rejection", () => {
  it("a rejected match followed one character later by a valid one: the valid one is found", () => {
    const e = smallEngine([{ id: "pair", pattern: "[-ab]{2}", edges: "word" }]);
    const r = distillText(e, "-ab");
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([[1, 3]]);
    expect(r.provenance.counters.pair).toMatchObject({ candidates: 2, rejected_edge: 1, fired: 1 });
  });
  it("it steps over a surrogate pair, never into the middle of one", () => {
    const e = smallEngine([{ id: "pair", pattern: "[😀-]{2}", edges: "word" }]);
    const r = distillText(e, "😀-x 😀-");
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([[4, 6]]);
  });
  it("a validator rejection restarts one code point later too", () => {
    const e = smallEngine([{ id: "digits", pattern: "[0-9]{4}", validators: ["luhn"] }]);
    // 5000 fails Luhn; the scan retries one character later, where 0000 passes.
    const r = distillText(e, "50000");
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([[1, 5]]);
    const r2 = distillText(e, "50001");
    expect(r2.removals).toEqual([]);
    expect(r2.provenance.counters.digits).toMatchObject({
      candidates: 2,
      rejected_validator: 2,
      fired: 0,
    });
  });
  it("after a hit, the scan resumes at the end of the match", () => {
    const e = smallEngine([{ id: "ab", pattern: "[a-z]{2}", surrogate: "#{n}" }]);
    const r = distillText(e, "ab cd e");
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([
      [0, 2],
      [3, 5],
    ]);
    // Two hits that touch are merged into one span (§2.6), but both are counted.
    const t = distillText(e, "abcde");
    expect(t.provenance.counters.ab.fired).toBe(2);
    expect(t.removals.map((x: any) => [x.start, x.end])).toEqual([[0, 4]]);
  });
  it("a zero-length match steps one code point", () => {
    // A rule that matches the empty string hits every fake, so a pack cannot hold one (PACK_NO_FAKE);
    // the scan is exercised directly.
    const { re, hasCapture } = compilePattern("x{0,1}", "");
    const rule = {
      id: "empty",
      category: "empty",
      action: "redact" as const,
      edges: "none" as const,
      validators: [],
      re,
      hasCapture,
    };
    const hits = scanPatternRule(rule, buildScanView("a😀b"), null);
    expect(hits.map((h) => [h.start, h.end])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe("ENG-13 line starts", () => {
  const engine = defaultEngine("agent");
  const finds = (text: string): number =>
    distillText(engine, text).findings.filter((f: any) => f.rule === "inject.role_label").length;
  it("Human: after \\n is found", () => expect(finds("x\nHuman: hi")).toBe(1));
  it("Human: after \\r\\n is found", () => expect(finds("x\r\nHuman: hi")).toBe(1));
  it("Human: after a lone \\r is not found", () => expect(finds("x\rHuman: hi")).toBe(0));
  it("Human: after U+2028 is not found", () => expect(finds("x Human: hi")).toBe(0));
  it("Human: after U+2029 is not found", () => expect(finds("x Human: hi")).toBe(0));
  it("Human: at the very start is found", () => expect(finds("Human: hi")).toBe(1));
  it("Human: in the middle of a line is not found", () => expect(finds("x Human: hi")).toBe(0));
});

describe("ENG-22 counters", () => {
  const rules = [
    { id: "ssn", pattern: "[0-9]{3}-[0-9]{2}-[0-9]{4}", edges: "numeric" },
    { id: "card", pattern: "[0-9]{4}", validators: ["luhn"] },
    { id: "mail", pattern: "[a-z]{1,10}@[a-z]{1,10}\\.com", edges: "word" },
  ];
  const engine = smallEngine(rules);
  it("no match: evaluated equals the segments for every rule, and fired is 0", () => {
    const r = engine.distill({
      segments: [
        { id: "a", text: "nothing here" },
        { id: "b", text: "" },
        { id: "c", text: "or here" },
      ],
    });
    if ("error" in r) throw new Error("refused");
    for (const id of ["ssn", "card", "mail"]) {
      expect(r.provenance.counters[id]).toEqual({
        evaluated: 3,
        candidates: 0,
        rejected_edge: 0,
        rejected_validator: 0,
        fired: 0,
      });
    }
  });
  it("one e-mail: that rule's fired is 1", () => {
    const r = distillText(engine, "write to ana@host.com now");
    expect(r.provenance.counters.mail).toEqual({
      evaluated: 1,
      candidates: 1,
      rejected_edge: 0,
      rejected_validator: 0,
      fired: 1,
    });
    expect(r.provenance.counters.ssn.fired).toBe(0);
  });
  it("a rejected edge and a rejected checksum are counted where §2.10 says", () => {
    const r = distillText(engine, "1-536-22-8914-2 and 1234");
    expect(r.provenance.counters.ssn).toEqual({
      evaluated: 1,
      candidates: 1,
      rejected_edge: 1,
      rejected_validator: 0,
      fired: 0,
    });
    // 1234 fails Luhn; so does every four-digit window of 8914-style digits: counted per candidate.
    expect(r.provenance.counters.card.rejected_validator).toBeGreaterThanOrEqual(1);
    expect(r.provenance.counters.card.fired).toBe(0);
  });
  it("a validator that accepts counts as fired, and candidates is the sum of the outcomes", () => {
    const r = distillText(engine, "0000 1234");
    const c = r.provenance.counters.card;
    expect(c.fired).toBe(1);
    expect(c.candidates).toBe(c.fired + c.rejected_edge + c.rejected_validator);
  });
  it("counters are sorted by rule id in the result", () => {
    const r = distillText(engine, "x");
    expect(Object.keys(r.provenance.counters)).toEqual(["card", "mail", "ssn"]);
  });
});
