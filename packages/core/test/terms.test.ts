// Tests of term lists: folding, boundaries, ties, and literal matching (ENG-14, ENG-15).
import { describe, expect, it } from "vitest";
import { foldTerm } from "../src/terms";
import { defaultEngine, distillText } from "./helpers";

const engine = defaultEngine("agent");
const dict = (terms: string[], name = "people", template = "Contact {n}"): any => ({
  dictionaries: [{ name, terms, template }],
});
const fired = (r: any, name = "people"): number =>
  r.provenance.counters[`dictionary.${name}`].fired;
const fold = (s: string): string => String.fromCodePoint(...foldTerm(s));

describe("ENG-14 term folding", () => {
  it("Ștefan, ŞTEFAN and Stefan all fold to stefan", () => {
    expect(fold("Ștefan")).toBe("stefan");
    expect(fold("ŞTEFAN")).toBe("stefan");
    expect(fold("Stefan")).toBe("stefan");
  });
  it("every run of white space folds to one space, including no-break and ideographic spaces", () => {
    expect(fold("Ana  \t 　 Pop")).toBe("ana pop");
  });
  it("ß stays ß, so Straße does not fold to Strasse (a known limit)", () => {
    expect(fold("Straße")).toBe("straße");
    const r = distillText(engine, "Strasse and Straße", dict(["Straße"]));
    expect(r.removals).toHaveLength(1);
    expect(r.removals[0].start).toBe(12);
  });
});

describe("ENG-14 term boundaries and ties", () => {
  const texts: [string, string, boolean][] = [
    ["a capital letter with a comma-below vs cedilla", "met ŞTEFAN today", true],
    ["plain ASCII", "met Stefan today", true],
    ["inside an e-mail address", "write stefan.p@northwind-mail.com", true],
    ["inside a path", "see /home/stefan/", true],
  ];
  for (const [name, text, found] of texts) {
    it(`term Ștefan: ${name}`, () => {
      const r = distillText(engine, text, dict(["Ștefan"]));
      expect(fired(r) > 0).toBe(found);
    });
  }
  it("term Ana is not found in Banana", () => {
    expect(fired(distillText(engine, "Banana", dict(["Ana"])))).toBe(0);
  });
  it("term Ana is not found in Ана (Cyrillic): terms are not transliterated", () => {
    expect(fired(distillText(engine, "Ана", dict(["Ana"])))).toBe(0);
  });
  it("term Ana is found in ana@example.com's neighbours: ana_smith and a path", () => {
    expect(fired(distillText(engine, "ana_smith", dict(["Ana"])))).toBe(1);
    expect(fired(distillText(engine, "/home/ana/", dict(["Ana"])))).toBe(1);
    expect(fired(distillText(engine, "ana@host.example", dict(["Ana"])))).toBe(1);
  });
  it("the boundary is a letter or digit: Ana2 and 2Ana do not match", () => {
    expect(fired(distillText(engine, "Ana2 2Ana", dict(["Ana"])))).toBe(0);
  });
  it("a term at the very start and very end of the segment is found", () => {
    const r = distillText(engine, "Ana", dict(["Ana"]));
    expect(r.segments[0].distillate).toBe("Contact 1");
  });
  it("two terms sharing a prefix: the longer one wins", () => {
    const r = distillText(engine, "Ana Maria and Ana", dict(["Ana", "Ana Maria"]));
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([
      [0, 9],
      [14, 17],
    ]);
    expect(r.segments[0].distillate).toBe("Contact 1 and Contact 2");
  });
  it("a longer term that fails its boundary falls back to the shorter one", () => {
    const r = distillText(engine, "Ana Mariax", dict(["Ana", "Ana Maria"]));
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([[0, 3]]);
  });
  it("white space inside a multi-word term matches any run of white space", () => {
    const r = distillText(engine, "Ana \n\t Pop wrote", dict(["Ana Pop"]));
    expect(r.removals.map((x: any) => [x.start, x.end])).toEqual([[0, 10]]);
  });
  it("the same term in different cases is the same value, so it gets one fake", () => {
    const r = distillText(engine, "ANA, ana, Ana", dict(["Ana"]));
    expect(r.segments[0].distillate).toBe("Contact 1, Contact 1, Contact 1");
  });
  it("two dictionaries are counted apart, by name", () => {
    const r = distillText(engine, "Ana met Bob", {
      dictionaries: [
        { name: "a", terms: ["Ana"], template: "A{n}" },
        { name: "b", terms: ["Bob"], template: "B{n}" },
      ],
    });
    expect(r.segments[0].distillate).toBe("A1 met B1");
    expect(fired(r, "a")).toBe(1);
    expect(fired(r, "b")).toBe(1);
  });
  it("candidates and rejected_edge are counted", () => {
    const r = distillText(engine, "Banana Ana", dict(["Ana"]));
    expect(r.provenance.counters["dictionary.people"]).toEqual({
      evaluated: 1,
      candidates: 3,
      rejected_edge: 2,
      rejected_validator: 0,
      fired: 1,
    });
  });
  it("the default template is Term {n}", () => {
    const r = engine.distill({
      segments: [{ id: "1", text: "Ana" }],
      dictionaries: [{ name: "people", terms: ["Ana"] }],
    });
    expect((r as any).segments[0].distillate).toBe("Term 1");
  });
  it("a term that is also e-mail text merges with the longer hit", () => {
    const r = distillText(engine, "mail stefan.p@northwind-mail.com", dict(["Stefan"]));
    expect(r.removals.map((x: any) => x.category)).toEqual(["contact.email"]);
    expect(fired(r)).toBe(1);
  });
  it("no record, counter or result key holds a term", () => {
    const r = distillText(engine, "Ana", dict(["Ana"], "people", "Contact {n}"));
    const text = JSON.stringify({ ...r, segments: undefined });
    expect(text.toLowerCase()).not.toContain("ana");
  });
});

describe("ENG-15 terms are literals", () => {
  const cases: [string, string, string][] = [
    ["a.b", "a.b", "axb"],
    ["(x)", "(x)", "x"],
    ["[0-9]{3}", "[0-9]{3}", "123"],
    ["\\\\", "\\\\", "\\"],
    [".*", ".*", "abc"],
    ["a|b", "a|b", "a b"],
    ["^start$", "^start$", "start"],
    ["(?i)abc", "(?i)abc", "ABC"],
  ];
  for (const [term, hit, miss] of cases) {
    it(`term ${JSON.stringify(term)} matches only itself`, () => {
      const dd = dict([term]);
      const a = distillText(engine, `x ${hit} y`, dd);
      expect(a.segments[0].distillate, "the literal is replaced").toBe("x Contact 1 y");
      const b = distillText(engine, `x ${miss} y`, dd);
      expect(fired(b)).toBe(0);
    });
  }
  it("a term cannot inject a pattern: a pathological term still finishes at once", () => {
    const t0 = Date.now();
    distillText(engine, "a".repeat(10000), dict(["(a+)+$"]));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
