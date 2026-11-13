// Provides the types of the rule pack, the profile, the request, the result and its records, the
// refusals, and the hand-written validators that check the shape of a pack, a profile and a
// request (§2.2, §2.10, §4.2). No schema library is used; every unknown field is refused.

export type SensitivityClass = "high" | "medium" | "low" | "defend";
export type Action = "redact" | "flag" | "neutralise" | "block";
export type Edges = "word" | "numeric" | "word_before" | "word_colon" | "none";

export const CLASSES: readonly SensitivityClass[] = ["high", "medium", "low", "defend"];
export const ACTIONS: readonly Action[] = ["redact", "flag", "neutralise", "block"];
export const EDGES: readonly Edges[] = ["word", "numeric", "word_before", "word_colon", "none"];
export const FLAG_CHARS = ["i", "m"] as const;

export interface CategoryDecl {
  class: SensitivityClass;
  /** A built-in template name (§2.8) or a template containing `{n}`. */
  surrogate: string;
}

export interface PatternRuleJson {
  id: string;
  category: string;
  kind: "pattern";
  pattern: string;
  flags: string;
  edges: string;
  validators: string[];
  action: string;
  variant?: string;
}

export interface TermsRuleJson {
  id: string;
  category: string;
  kind: "terms";
  terms: string[];
  action: string;
  variant?: string;
}

export type RuleJson = PatternRuleJson | TermsRuleJson;

export interface DictionaryJson {
  name: string;
  category: string;
  template: string;
  terms: string[];
}

export interface RulePackJson {
  format: string;
  name: string;
  version: string;
  categories: Record<string, CategoryDecl>;
  rules: RuleJson[];
  dictionaries: DictionaryJson[];
  neutralise_literals: string[];
}

export interface ProfileJson {
  format: string;
  name: string;
  actions: Record<string, string>;
}

export interface SegmentInput {
  id: string;
  text: string;
  kind?: string;
}
export interface DictionaryInput {
  name: string;
  terms: string[];
  template?: string;
}
export interface DistillRequest {
  segments: SegmentInput[];
  dictionaries?: DictionaryInput[];
  profile?: string;
  mode?: string;
  objective?: { kind: string; task?: string };
}

export interface Counters {
  evaluated: number;
  candidates: number;
  rejected_edge: number;
  rejected_validator: number;
  fired: number;
}
export interface Removal {
  segment: string;
  start: number;
  end: number;
  category: string;
  variant?: string;
  rule: string;
  fake: string;
}
export interface Finding {
  segment: string;
  start: number;
  end: number;
  category: string;
  variant?: string;
  rule: string;
  action: string;
}
export interface Warning {
  code: string;
  segment?: string;
}
export interface Provenance {
  rulepack: { name: string; version: string; hash: string };
  profile: string;
  engine: { name: string; version: string; unicode: string };
  certified: boolean;
  counters: Record<string, Counters>;
}
export interface DistillResult {
  mode: "rules";
  segments?: { id: string; distillate: string }[];
  removals?: Removal[];
  findings?: Finding[];
  warnings?: Warning[];
  blocked?: { category: string; rule: string };
  provenance: Provenance;
}
export interface DistillRefusal {
  error: { code: string; message: string };
}

/** The codes with which a request is refused (§2.11, §4.2). */
export const REFUSAL_MESSAGES = {
  INVALID_ARGUMENTS: "The arguments are missing, of the wrong type, or not allowed.",
  EMPTY_INPUT: "There is no text to distil.",
  DUPLICATE_SEGMENT_ID: "Two segments have the same id.",
  TOO_MANY_SEGMENTS: "There are more segments than the limit allows.",
  INPUT_TOO_LARGE: "The text is larger than the limit allows.",
  TOO_MANY_DICTIONARIES: "There are more dictionaries than the limit allows.",
  TOO_MANY_TERMS: "There are more terms than the limit allows.",
  TERM_TOO_SHORT: "A term is shorter than the minimum.",
  TERM_TOO_LONG: "A term is longer than the maximum.",
  UNKNOWN_PROFILE: "The profile is not one of the built-in profiles.",
  UNSUPPORTED_MODE: "The mode is not supported.",
  RESULT_TOO_LARGE: "The result is larger than the limit allows.",
  DEADLINE: "The call did not finish in time.",
  INTERNAL: "An internal error stopped the request. No text was returned.",
} as const;
export type RefusalCode = keyof typeof REFUSAL_MESSAGES;

export function refusal(code: RefusalCode): DistillRefusal {
  return { error: { code, message: REFUSAL_MESSAGES[code] } };
}

/** Thrown by the loaders. `code` is a loader code such as PACK_SCHEMA or PROFILE_UNKNOWN_ACTION. */
export class RulePackError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RulePackError";
    this.code = code;
  }
}

/** Thrown while validating a request; carries the refusal code. */
export class RequestError extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode) {
    super(code);
    this.name = "RequestError";
    this.code = code;
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Checks that `v` is an object with exactly the allowed keys, the required ones present. */
function checkKeys(
  v: unknown,
  required: readonly string[],
  optional: readonly string[],
  fail: (detail: string) => never,
  what: string,
): Obj {
  if (!isObj(v)) return fail(`${what} is not an object`);
  for (const k of required) if (!(k in v)) fail(`${what} lacks "${k}"`);
  for (const k of Object.keys(v)) {
    if (!required.includes(k) && !optional.includes(k)) fail(`${what} has unknown field "${k}"`);
  }
  return v;
}

function str(v: unknown, fail: (d: string) => never, what: string): string {
  if (typeof v !== "string") return fail(`${what} is not a string`);
  return v;
}

function strArray(v: unknown, fail: (d: string) => never, what: string): string[] {
  if (!Array.isArray(v)) return fail(`${what} is not an array`);
  return v.map((x, i) => str(x, fail, `${what}[${i}]`));
}

/** Checks the shape of a rule pack (types and unknown fields) and returns it typed. */
export function parseRulePackShape(json: unknown): RulePackJson {
  const fail = (d: string): never => {
    throw new RulePackError("PACK_SCHEMA", d);
  };
  const top = checkKeys(
    json,
    ["format", "name", "version", "categories", "rules", "dictionaries", "neutralise_literals"],
    [],
    fail,
    "the pack",
  );
  const format = str(top.format, fail, "format");
  if (format !== "rulepack/1") {
    throw new RulePackError("PACK_FORMAT", "format is not rulepack/1");
  }
  const name = str(top.name, fail, "name");
  const version = str(top.version, fail, "version");
  if (!isObj(top.categories)) fail("categories is not an object");
  const categories: Record<string, CategoryDecl> = {};
  for (const [cat, raw] of Object.entries(top.categories as Obj)) {
    const o = checkKeys(raw, ["class", "surrogate"], [], fail, `category ${cat}`);
    const cls = str(o.class, fail, `category ${cat} class`);
    if (!CLASSES.includes(cls as SensitivityClass)) fail(`category ${cat} has unknown class`);
    categories[cat] = {
      class: cls as SensitivityClass,
      surrogate: str(o.surrogate, fail, `category ${cat} surrogate`),
    };
  }
  if (!Array.isArray(top.rules)) fail("rules is not an array");
  const rules: RuleJson[] = (top.rules as unknown[]).map((raw, i) => {
    const what = `rules[${i}]`;
    if (!isObj(raw)) return fail(`${what} is not an object`);
    const kindRaw = raw.kind;
    if (typeof kindRaw !== "string") return fail(`${what} kind is not a string`);
    if (kindRaw === "pattern") {
      const o = checkKeys(
        raw,
        ["id", "category", "kind", "pattern", "flags", "edges", "validators", "action"],
        ["variant"],
        fail,
        what,
      );
      const r: PatternRuleJson = {
        id: str(o.id, fail, `${what} id`),
        category: str(o.category, fail, `${what} category`),
        kind: "pattern",
        pattern: str(o.pattern, fail, `${what} pattern`),
        flags: str(o.flags, fail, `${what} flags`),
        edges: str(o.edges, fail, `${what} edges`),
        validators: strArray(o.validators, fail, `${what} validators`),
        action: str(o.action, fail, `${what} action`),
      };
      if ("variant" in o) r.variant = str(o.variant, fail, `${what} variant`);
      return r;
    }
    if (kindRaw === "terms") {
      const o = checkKeys(
        raw,
        ["id", "category", "kind", "terms", "action"],
        ["variant"],
        fail,
        what,
      );
      const r: TermsRuleJson = {
        id: str(o.id, fail, `${what} id`),
        category: str(o.category, fail, `${what} category`),
        kind: "terms",
        terms: strArray(o.terms, fail, `${what} terms`),
        action: str(o.action, fail, `${what} action`),
      };
      if ("variant" in o) r.variant = str(o.variant, fail, `${what} variant`);
      return r;
    }
    // An unknown kind: report it with its own code, after the fields that name it are known.
    throw new RulePackError("PACK_UNKNOWN_KIND", `${what} has unknown kind`);
  });
  if (!Array.isArray(top.dictionaries)) fail("dictionaries is not an array");
  const dictionaries: DictionaryJson[] = (top.dictionaries as unknown[]).map((raw, i) => {
    const what = `dictionaries[${i}]`;
    const o = checkKeys(raw, ["name", "category", "template", "terms"], [], fail, what);
    return {
      name: str(o.name, fail, `${what} name`),
      category: str(o.category, fail, `${what} category`),
      template: str(o.template, fail, `${what} template`),
      terms: strArray(o.terms, fail, `${what} terms`),
    };
  });
  const neutralise_literals = strArray(top.neutralise_literals, fail, "neutralise_literals");
  return { format, name, version, categories, rules, dictionaries, neutralise_literals };
}

/** Checks the shape of a profile. `prefix` is "PROFILE" for profiles. */
export function parseProfileShape(json: unknown): ProfileJson {
  const fail = (d: string): never => {
    throw new RulePackError("PROFILE_SCHEMA", d);
  };
  const top = checkKeys(json, ["format", "name", "actions"], [], fail, "the profile");
  const format = str(top.format, fail, "format");
  if (format !== "profile/1") throw new RulePackError("PROFILE_FORMAT", "format is not profile/1");
  const name = str(top.name, fail, "name");
  if (!isObj(top.actions)) fail("actions is not an object");
  const actions: Record<string, string> = {};
  for (const [k, v] of Object.entries(top.actions as Obj)) actions[k] = str(v, fail, `action ${k}`);
  return { format, name, actions };
}

export const LIMITS = {
  segments: { min: 1, max: 1000 },
  segmentIdLength: { min: 1, max: 64 },
  totalBytes: 1_048_576,
  dictionaries: 20,
  terms: 10_000,
  termLength: { min: 2, max: 200 },
  dictionaryNameLength: { min: 1, max: 32 },
} as const;

/**
 * Checks the types and the allowed argument names of a request. Limits (§2.11) are checked by the
 * engine. Throws RequestError(INVALID_ARGUMENTS) for any shape problem, and EMPTY_INPUT for an
 * empty segment list.
 */
export function parseRequestShape(req: unknown): DistillRequest {
  const bad = (): never => {
    throw new RequestError("INVALID_ARGUMENTS");
  };
  if (!isObj(req)) return bad();
  for (const k of Object.keys(req)) {
    if (!["segments", "dictionaries", "profile", "mode", "objective"].includes(k)) bad();
  }
  if (!Array.isArray(req.segments)) return bad();
  const segments: SegmentInput[] = req.segments.map((s: unknown) => {
    if (!isObj(s)) return bad();
    for (const k of Object.keys(s)) if (!["id", "text", "kind"].includes(k)) bad();
    if (typeof s.id !== "string" || typeof s.text !== "string") return bad();
    if ("kind" in s && typeof s.kind !== "string") bad();
    const out: SegmentInput = { id: s.id, text: s.text };
    if (typeof s.kind === "string") out.kind = s.kind;
    return out;
  });
  const out: DistillRequest = { segments };
  if ("dictionaries" in req) {
    if (!Array.isArray(req.dictionaries)) return bad();
    out.dictionaries = req.dictionaries.map((d: unknown) => {
      if (!isObj(d)) return bad();
      for (const k of Object.keys(d)) if (!["name", "terms", "template"].includes(k)) bad();
      if (typeof d.name !== "string" || !Array.isArray(d.terms)) return bad();
      if (!d.terms.every((t: unknown) => typeof t === "string")) bad();
      if ("template" in d && typeof d.template !== "string") bad();
      const dd: DictionaryInput = { name: d.name, terms: d.terms as string[] };
      if (typeof d.template === "string") dd.template = d.template;
      return dd;
    });
  }
  if ("profile" in req) {
    if (typeof req.profile !== "string") return bad();
    out.profile = req.profile;
  }
  if ("mode" in req) {
    if (typeof req.mode !== "string") return bad();
    out.mode = req.mode;
  }
  if ("objective" in req) {
    const o = req.objective;
    if (!isObj(o)) return bad();
    for (const k of Object.keys(o)) if (!["kind", "task"].includes(k)) bad();
    if (typeof o.kind !== "string" || !["store", "forward", "task"].includes(o.kind)) bad();
    if ("task" in o && typeof o.task !== "string") bad();
    out.objective = { kind: o.kind as string };
    if (typeof o.task === "string") out.objective.task = o.task;
  }
  return out;
}
