// Tests of the hand-written validators of the pack, profile and request shapes (step 1.2): each
// field of each type is accepted, refused when missing, refused when of the wrong type, and
// refused when an unknown field is added.
import { describe, expect, it } from "vitest";
import {
  RequestError,
  RulePackError,
  parseProfileShape,
  parseRequestShape,
  parseRulePackShape,
  refusal,
  REFUSAL_MESSAGES,
} from "../src/schema";
import { packJson } from "./helpers";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RulePackError || e instanceof RequestError) return e.code;
    throw e;
  }
  return "OK";
};

/** A coarse kind: null, array, or typeof. */
const kindOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const WRONG = [5, "text", null, true, [], {}];

/** Every path to a field of a JSON value, as arrays of keys. */
function paths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => [[...prefix, i], ...paths(v, [...prefix, i])]);
  if (typeof value === "object" && value !== null) {
    return Object.keys(value).flatMap((k) => [
      [...prefix, k],
      ...paths((value as any)[k], [...prefix, k]),
    ]);
  }
  return [];
}
function at(root: any, path: (string | number)[]): { parent: any; key: string | number } {
  let parent = root;
  for (const k of path.slice(0, -1)) parent = parent[k];
  return { parent, key: path[path.length - 1] as string | number };
}

describe("schema: the rule pack's shape", () => {
  const dictPack = packJson([{ id: "a.one", pattern: "[0-9]{3}" }], {
    dictionaries: [{ name: "d", category: "dictionary.d", template: "T {n}", terms: ["abc"] }],
  }) as any;
  dictPack.categories["dictionary.d"] = { class: "high", surrogate: "T {n}" };
  dictPack.rules.push({
    id: "t.rule",
    category: "a.one",
    kind: "terms",
    terms: ["xy"],
    action: "flag",
    variant: "v",
  });
  dictPack.rules[0].variant = "ca";

  it("a valid pack is accepted", () => {
    expect(codeOf(() => parseRulePackShape(dictPack))).toBe("OK");
  });

  it("every field is refused when missing (except the optional variant)", () => {
    for (const path of paths(dictPack)) {
      const key = path[path.length - 1];
      if (typeof key === "number" || key === "variant") continue;
      // Skip fields inside arrays of strings (terms, validators, literals) and the category map keys.
      const p = clone(dictPack);
      const { parent } = at(p, path);
      if (Array.isArray(parent)) continue;
      if (path[0] === "categories" && path.length === 2) continue;
      delete parent[key as string | number];
      expect(
        codeOf(() => parseRulePackShape(p)),
        path.join("."),
      ).not.toBe("OK");
    }
  });

  it("every field is refused when of the wrong type", () => {
    for (const path of paths(dictPack)) {
      const key = path[path.length - 1] as string | number;
      const { parent } = at(clone(dictPack), path);
      const original = parent[key];
      for (const wrong of WRONG) {
        if (JSON.stringify(wrong) === JSON.stringify(original)) continue;
        // A wrong type is only wrong when it differs in type from the original.
        const sameType =
          typeof wrong === typeof original &&
          Array.isArray(wrong) === Array.isArray(original) &&
          (wrong === null) === (original === null);
        if (sameType) continue;
        const p = clone(dictPack);
        at(p, path).parent[key] = wrong;
        expect(
          codeOf(() => parseRulePackShape(p)),
          `${path.join(".")} = ${JSON.stringify(wrong)}`,
        ).not.toBe("OK");
      }
    }
  });

  it("an unknown field is refused at every level", () => {
    const places: (string | number)[][] = [
      [],
      ["categories", "a.one"],
      ["rules", 0],
      ["rules", 1],
      ["dictionaries", 0],
    ];
    for (const place of places) {
      const p = clone(dictPack);
      const target = place.length === 0 ? p : place.reduce((o: any, k) => o[k], p);
      target.unknown_field = 1;
      expect(
        codeOf(() => parseRulePackShape(p)),
        place.join("."),
      ).toBe("PACK_SCHEMA");
    }
  });

  it("an element of an array of strings of the wrong type is refused", () => {
    for (const path of [
      ["rules", 0, "validators"],
      ["rules", 1, "terms"],
      ["dictionaries", 0, "terms"],
      ["neutralise_literals"],
    ]) {
      const p = clone(dictPack);
      const arr = path.reduce((o: any, k) => o[k], p);
      arr.push(5);
      expect(
        codeOf(() => parseRulePackShape(p)),
        path.join("."),
      ).toBe("PACK_SCHEMA");
    }
  });

  it("a wrong format is PACK_FORMAT, an unknown kind is PACK_UNKNOWN_KIND", () => {
    const p = clone(dictPack);
    p.format = "rulepack/2";
    expect(codeOf(() => parseRulePackShape(p))).toBe("PACK_FORMAT");
    const q = clone(dictPack);
    q.rules[0].kind = "other";
    expect(codeOf(() => parseRulePackShape(q))).toBe("PACK_UNKNOWN_KIND");
  });
});

describe("schema: the profile's shape", () => {
  const profile = { format: "profile/1", name: "p", actions: { "a.one": "flag" } };
  it("a valid profile is accepted", () =>
    expect(codeOf(() => parseProfileShape(profile))).toBe("OK"));
  it("each field is refused when missing, mistyped or unknown", () => {
    for (const key of Object.keys(profile)) {
      const missing: any = clone(profile);
      delete missing[key];
      expect(
        codeOf(() => parseProfileShape(missing)),
        `missing ${key}`,
      ).not.toBe("OK");
      for (const wrong of WRONG) {
        const p: any = clone(profile);
        // Only a value of another kind than the original is wrong; a format must also be exact.
        if (kindOf(wrong) === kindOf(p[key]) && key !== "format") continue;
        p[key] = wrong;
        expect(
          codeOf(() => parseProfileShape(p)),
          `${key}=${JSON.stringify(wrong)}`,
        ).not.toBe("OK");
      }
    }
    expect(codeOf(() => parseProfileShape({ ...profile, extra: 1 }))).toBe("PROFILE_SCHEMA");
    expect(codeOf(() => parseProfileShape({ ...profile, actions: { x: 5 } }))).toBe(
      "PROFILE_SCHEMA",
    );
    expect(codeOf(() => parseProfileShape({ ...profile, format: "profile/2" }))).toBe(
      "PROFILE_FORMAT",
    );
    expect(codeOf(() => parseProfileShape(null))).toBe("PROFILE_SCHEMA");
  });
});

describe("schema: the request's shape", () => {
  const full = {
    segments: [{ id: "a", text: "t", kind: "email" }],
    dictionaries: [{ name: "d", terms: ["ab"], template: "T {n}" }],
    profile: "agent",
    mode: "rules",
    objective: { kind: "task", task: "x" },
  };
  it("a full request is accepted, and a request with only segments", () => {
    expect(codeOf(() => parseRequestShape(full))).toBe("OK");
    expect(codeOf(() => parseRequestShape({ segments: [{ id: "a", text: "" }] }))).toBe("OK");
  });
  it("every field is refused when of the wrong type", () => {
    for (const path of paths(full)) {
      const key = path[path.length - 1] as string | number;
      const original = at(clone(full), path).parent[key];
      for (const wrong of WRONG) {
        const sameType =
          typeof wrong === typeof original &&
          Array.isArray(wrong) === Array.isArray(original) &&
          (wrong === null) === (original === null);
        if (sameType) continue;
        const p: any = clone(full);
        at(p, path).parent[key] = wrong;
        if (path.join(".") === "segments.0.kind" && wrong === undefined) continue;
        expect(
          codeOf(() => parseRequestShape(p)),
          `${path.join(".")}=${JSON.stringify(wrong)}`,
        ).toBe("INVALID_ARGUMENTS");
      }
    }
  });
  it("every required field is refused when missing", () => {
    for (const path of [
      ["segments"],
      ["segments", 0, "id"],
      ["segments", 0, "text"],
      ["dictionaries", 0, "name"],
      ["dictionaries", 0, "terms"],
      ["objective", "kind"],
    ]) {
      const p: any = clone(full);
      const { parent, key } = at(p, path);
      delete parent[key as string | number];
      expect(
        codeOf(() => parseRequestShape(p)),
        path.join("."),
      ).toBe("INVALID_ARGUMENTS");
    }
  });
  it("an unknown field is refused at every level", () => {
    for (const place of [[], ["segments", 0], ["dictionaries", 0], ["objective"]]) {
      const p: any = clone(full);
      (place.length === 0 ? p : place.reduce((o: any, k) => o[k], p)).extra = 1;
      expect(
        codeOf(() => parseRequestShape(p)),
        place.join("."),
      ).toBe("INVALID_ARGUMENTS");
    }
  });
  it("an objective kind other than store, forward or task is refused", () => {
    for (const kind of ["store", "forward", "task"]) {
      expect(codeOf(() => parseRequestShape({ segments: [], objective: { kind } }))).toBe("OK");
    }
    expect(codeOf(() => parseRequestShape({ segments: [], objective: { kind: "play" } }))).toBe(
      "INVALID_ARGUMENTS",
    );
  });
  it("non-objects are refused", () => {
    for (const v of [null, undefined, 5, "x", [], true])
      expect(codeOf(() => parseRequestShape(v))).toBe("INVALID_ARGUMENTS");
  });
});

describe("schema: refusals", () => {
  it("every code has a fixed message, and a refusal carries exactly code and message", () => {
    for (const code of Object.keys(REFUSAL_MESSAGES) as (keyof typeof REFUSAL_MESSAGES)[]) {
      expect(refusal(code)).toEqual({ error: { code, message: REFUSAL_MESSAGES[code] } });
      expect(REFUSAL_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });
  it("the codes are those of §4.2", () => {
    expect(Object.keys(REFUSAL_MESSAGES).sort()).toEqual(
      [
        "INVALID_ARGUMENTS",
        "EMPTY_INPUT",
        "DUPLICATE_SEGMENT_ID",
        "TOO_MANY_SEGMENTS",
        "INPUT_TOO_LARGE",
        "TOO_MANY_DICTIONARIES",
        "TOO_MANY_TERMS",
        "TERM_TOO_SHORT",
        "TERM_TOO_LONG",
        "UNKNOWN_PROFILE",
        "UNSUPPORTED_MODE",
        "RESULT_TOO_LARGE",
        "DEADLINE",
        "INTERNAL",
      ].sort(),
    );
  });
});
