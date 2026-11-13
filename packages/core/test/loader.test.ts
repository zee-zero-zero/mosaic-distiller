// Tests of the rule-pack loader, the profile loader and the version hash (ENG-23, ENG-24).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngine, loadProfile, loadRulePack } from "../src/index";
import { RulePackError } from "../src/schema";
import { packJson, profileJson, readJson } from "./helpers";

const KNOWN_HASH = "4d50a65812057a789361080cfd279dfd1b57dc0b707c02c7859beb6f3ba514db";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RulePackError);
    return (e as RulePackError).code;
  }
  return "LOADED";
}

/** A deep copy of a valid pack that `edit` may break in one way. */
function broken(edit: (p: any) => void): unknown {
  const p = JSON.parse(
    JSON.stringify(
      packJson([
        { id: "a.one", pattern: "[0-9]{3}" },
        { id: "a.two", pattern: "[a-z]{3}" },
      ]),
    ),
  );
  edit(p);
  return p;
}

afterEach(() => vi.unstubAllGlobals());

describe("ENG-23 loader: each refusal has its own code, and no engine is built", () => {
  const cases: [string, string, (p: any) => void][] = [
    ["unknown format", "PACK_FORMAT", (p) => (p.format = "rulepack/2")],
    ["missing field", "PACK_SCHEMA", (p) => delete p.rules],
    ["unknown top-level field", "PACK_SCHEMA", (p) => (p.extra = 1)],
    ["rules not an array", "PACK_SCHEMA", (p) => (p.rules = {})],
    ["a rule of the wrong type", "PACK_SCHEMA", (p) => (p.rules[0].pattern = 5)],
    ["unknown rule field", "PACK_SCHEMA", (p) => (p.rules[0].extra = 1)],
    ["a rule that is null", "PACK_SCHEMA", (p) => (p.rules[0] = null)],
    ["an unknown class", "PACK_SCHEMA", (p) => (p.categories["a.one"].class = "huge")],
    ["unknown kind", "PACK_UNKNOWN_KIND", (p) => (p.rules[0].kind = "checksum")],
    [
      "unknown validator",
      "PACK_UNKNOWN_VALIDATOR",
      (p) => (p.rules[0].validators = ["no_such_validator"]),
    ],
    [
      "a validator named like an Object property",
      "PACK_UNKNOWN_VALIDATOR",
      (p) => (p.rules[0].validators = ["constructor"]),
    ],
    ["unknown action", "PACK_UNKNOWN_ACTION", (p) => (p.rules[0].action = "delete")],
    ["unknown flag", "PACK_UNKNOWN_FLAG", (p) => (p.rules[0].flags = "s")],
    ["a repeated flag", "PACK_UNKNOWN_FLAG", (p) => (p.rules[0].flags = "ii")],
    ["unknown edge", "PACK_UNKNOWN_EDGE", (p) => (p.rules[0].edges = "line")],
    ["a lookbehind", "PACK_PATTERN_SUBSET", (p) => (p.rules[0].pattern = "(?<=a)b")],
    ["\\d", "PACK_PATTERN_SUBSET", (p) => (p.rules[0].pattern = "\\d{3}")],
    ["a plus", "PACK_PATTERN_SUBSET", (p) => (p.rules[0].pattern = "a+")],
    ["two capture groups", "PACK_PATTERN_SUBSET", (p) => (p.rules[0].pattern = "(a)(b)")],
    ["a duplicate rule id", "PACK_DUPLICATE_ID", (p) => (p.rules[1].id = "a.one")],
    ["an undeclared category", "PACK_UNDECLARED_CATEGORY", (p) => (p.rules[0].category = "x.y")],
    [
      "a missing built-in category",
      "PACK_UNDECLARED_CATEGORY",
      (p) => delete p.categories["hidden.invisible"],
    ],
    ["no rules", "PACK_NO_RULES", (p) => (p.rules = [])],
    [
      "a one-letter term",
      "PACK_TERM_TOO_SHORT",
      (p) => {
        p.categories["dictionary.d"] = { class: "high", surrogate: "Term {n}" };
        p.dictionaries = [
          { name: "d", category: "dictionary.d", template: "Term {n}", terms: ["a"] },
        ];
      },
    ],
    [
      "a term that folds to one letter",
      "PACK_TERM_TOO_SHORT",
      (p) => {
        p.categories["dictionary.d"] = { class: "high", surrogate: "Term {n}" };
        p.dictionaries = [
          { name: "d", category: "dictionary.d", template: "Term {n}", terms: ["é́"] },
        ];
      },
    ],
    [
      "a term of only combining marks",
      "PACK_TERM_TOO_SHORT",
      (p) => {
        p.categories["dictionary.d"] = { class: "high", surrogate: "Term {n}" };
        p.dictionaries = [
          { name: "d", category: "dictionary.d", template: "Term {n}", terms: ["́́́"] },
        ];
      },
    ],
    [
      "a term that is too long",
      "PACK_TERM_TOO_LONG",
      (p) => {
        p.categories["dictionary.d"] = { class: "high", surrogate: "Term {n}" };
        p.dictionaries = [
          { name: "d", category: "dictionary.d", template: "Term {n}", terms: ["a".repeat(201)] },
        ];
      },
    ],
    [
      "a surrogate that is not a template",
      "PACK_NO_FAKE",
      (p) => (p.categories["a.one"].surrogate = "plain text"),
    ],
    [
      "a category whose every fake another rule hits",
      "PACK_NO_FAKE",
      (p) => {
        p.categories["a.one"].surrogate = "email";
        p.rules[1].pattern = "person[0-9]{1,3}@example\\.com";
      },
    ],
    [
      "a dictionary template without {n}",
      "PACK_NO_FAKE",
      (p) => {
        p.categories["dictionary.d"] = { class: "high", surrogate: "Term {n}" };
        p.dictionaries = [
          { name: "d", category: "dictionary.d", template: "Term", terms: ["abc"] },
        ];
      },
    ],
  ];
  for (const [name, code, edit] of cases) {
    it(`${name} -> ${code}`, () => {
      expect(codeOf(() => loadRulePack(broken(edit)))).toBe(code);
    });
  }

  it("a pattern that parses but does not compile -> PACK_PATTERN_COMPILE", () => {
    const real = RegExp;
    vi.stubGlobal(
      "RegExp",
      new Proxy(real, {
        construct(target, args) {
          if (typeof args[1] === "string" && args[1].includes("g")) throw new SyntaxError("stub");
          return Reflect.construct(target, args);
        },
      }),
    );
    expect(codeOf(() => loadRulePack(broken(() => undefined)))).toBe("PACK_PATTERN_COMPILE");
  });

  it("a refused pack builds no engine and holds no partial rules", () => {
    const p = broken((q) => (q.rules[1].pattern = "a+"));
    expect(() =>
      createEngine({ pack: loadRulePack(p), profiles: [], defaultProfile: "x" }),
    ).toThrow(RulePackError);
  });

  it("non-object input is refused as PACK_SCHEMA", () => {
    for (const v of [null, 3, "x", [], undefined])
      expect(codeOf(() => loadRulePack(v))).toBe("PACK_SCHEMA");
  });

  it("the default pack loads", () => {
    expect(codeOf(() => loadRulePack(readJson("rulepacks/default.json")))).toBe("LOADED");
  });
});

describe("ENG-23 loader: profiles", () => {
  const pack = loadRulePack(packJson([{ id: "a.one" }]));
  it("a valid profile loads, with category and category/variant keys", () => {
    expect(
      codeOf(() => loadProfile(profileJson({ "a.one": "flag", "a.one/private": "redact" }), pack)),
    ).toBe("LOADED");
  });
  it("PROFILE_FORMAT", () => {
    expect(codeOf(() => loadProfile({ format: "profile/9", name: "p", actions: {} }, pack))).toBe(
      "PROFILE_FORMAT",
    );
  });
  it("PROFILE_SCHEMA: unknown field, wrong type, bad variant", () => {
    expect(
      codeOf(() => loadProfile({ format: "profile/1", name: "p", actions: {}, x: 1 }, pack)),
    ).toBe("PROFILE_SCHEMA");
    expect(
      codeOf(() => loadProfile({ format: "profile/1", name: "p", actions: { "a.one": 1 } }, pack)),
    ).toBe("PROFILE_SCHEMA");
    expect(codeOf(() => loadProfile(profileJson({ "a.one/Bad Variant": "flag" }), pack))).toBe(
      "PROFILE_SCHEMA",
    );
  });
  it("PROFILE_UNKNOWN_ACTION", () => {
    expect(codeOf(() => loadProfile(profileJson({ "a.one": "erase" }), pack))).toBe(
      "PROFILE_UNKNOWN_ACTION",
    );
  });
  it("PROFILE_UNDECLARED_CATEGORY", () => {
    expect(codeOf(() => loadProfile(profileJson({ "no.such": "flag" }), pack))).toBe(
      "PROFILE_UNDECLARED_CATEGORY",
    );
  });
  it("both built-in profiles load against the default pack", () => {
    const real = loadRulePack(readJson("rulepacks/default.json"));
    for (const n of ["agent", "document"])
      expect(codeOf(() => loadProfile(readJson(`profiles/${n}.json`), real))).toBe("LOADED");
  });
});

describe("ENG-24 hash", () => {
  const known = readJson("packages/core/test/packs/known-pack.json") as any;

  it("a known pack gives a hash computed independently with Python (RFC 8785 when keys are in the BMP)", () => {
    expect(loadRulePack(known).hash).toBe(KNOWN_HASH);
  });

  it("the hash is lower-case hex of 64 characters", () => {
    expect(loadRulePack(known).hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reordering rules, dictionaries, terms and literals leaves the hash unchanged", () => {
    const p = JSON.parse(JSON.stringify(known));
    p.rules.reverse();
    p.dictionaries.reverse();
    p.dictionaries[0].terms.reverse();
    p.neutralise_literals.reverse();
    expect(loadRulePack(p).hash).toBe(KNOWN_HASH);
  });

  it("reordering the keys of an object leaves the hash unchanged", () => {
    const p = JSON.parse(JSON.stringify(known));
    p.rules[0] = Object.fromEntries(Object.entries(p.rules[0]).reverse());
    const reversed = Object.fromEntries(Object.entries(p).reverse());
    expect(loadRulePack(reversed).hash).toBe(KNOWN_HASH);
  });

  it("changing each field of each rule changes the hash", () => {
    const base = loadRulePack(known).hash;
    const seen = new Set<string>([base]);
    const edits: [string, (r: any) => void][] = [
      ["id", (r) => (r.id += "x")],
      ["pattern", (r) => (r.pattern = r.pattern + "z")],
      ["flags", (r) => (r.flags = r.flags === "i" ? "" : "i")],
      ["edges", (r) => (r.edges = r.edges === "none" ? "word" : "none")],
      ["validators", (r) => (r.validators = [...r.validators, "has_letter"])],
      ["action", (r) => (r.action = "flag")],
      ["variant", (r) => (r.variant = (r.variant ?? "") + "v")],
    ];
    for (let i = 0; i < known.rules.length; i++) {
      for (const [field, edit] of edits) {
        const p = JSON.parse(JSON.stringify(known));
        edit(p.rules[i]);
        // A changed id must stay a declared-category rule; ids are free, categories are not changed.
        const h = loadRulePack(p).hash;
        expect(h, `rule ${i} field ${field}`).not.toBe(base);
        expect(seen.has(h), `rule ${i} field ${field} collides`).toBe(false);
        seen.add(h);
      }
    }
  });

  it("changing the category of a rule, a category declaration, the name, the version or a literal changes the hash", () => {
    const base = loadRulePack(known).hash;
    const edits: ((p: any) => void)[] = [
      (p) => (p.rules[0].category = "gov_id.us_ssn"),
      (p) => (p.categories["contact.email"].class = "low"),
      (p) => (p.categories["contact.email"].surrogate = "shape"),
      (p) => (p.name = "other"),
      (p) => (p.version = "1.2.4"),
      (p) => p.neutralise_literals.push("<x"),
      (p) => (p.dictionaries[0].terms[0] = "Ana Popa"),
      (p) => (p.dictionaries[0].template = "Colleague {n}!"),
    ];
    const hashes = new Set<string>();
    for (const edit of edits) {
      const p = JSON.parse(JSON.stringify(known));
      edit(p);
      const h = loadRulePack(p).hash;
      expect(h).not.toBe(base);
      hashes.add(h);
    }
    expect(hashes.size).toBe(edits.length);
  });

  it("the order of validators matters", () => {
    const p = JSON.parse(JSON.stringify(known));
    p.rules[1].validators = ["ssn_rules", "not_mask"];
    const a = loadRulePack(p).hash;
    p.rules[1].validators = ["not_mask", "ssn_rules"];
    expect(loadRulePack(p).hash).not.toBe(a);
  });
});
