// Provides the rule-pack and profile loaders (§2.2, §2.7). Each refusal has its own code and
// there is no partial load. `loadRulePack` checks shape, enumerations, patterns (against the
// portable subset, then by compiling), ids, categories, term lengths and fake values, and
// computes the version hash: SHA-256 of the pack's RFC 8785 canonical form, written as lower-case
// hex, with rules, dictionaries, terms and literals put in code-point order first so that the
// order of the file never matters.
import { createHash } from "node:crypto";
import { canonicalize } from "./jcs";
import { compilePattern } from "./pattern/compile";
import {
  ACTIONS,
  EDGES,
  FLAG_CHARS,
  RulePackError,
  parseProfileShape,
  parseRulePackShape,
  type Action,
  type Edges,
  type RulePackJson,
} from "./schema";
import { surrogateIsUsable, surrogateIsValid } from "./fakes";
import { buildTermSet, foldTerm } from "./terms";
import { VALIDATORS } from "./validators/index";
import { cmpCodePoints } from "./util";
import type { CompiledPatternRule, CompiledTermsRule, Profile, RulePack, Ruleset } from "./types";

/** The categories the engine itself reports, so every pack must declare them. */
export const BUILTIN_CATEGORIES = ["hidden.invisible", "inject.consumer_markup"] as const;

export const TERM_LENGTH = { min: 2, max: 200 };

function checkTerms(terms: string[], what: string): void {
  for (const t of terms) {
    const n = foldTerm(t).length;
    if (n < TERM_LENGTH.min)
      throw new RulePackError("PACK_TERM_TOO_SHORT", `${what} has a term that is too short`);
    if (n > TERM_LENGTH.max)
      throw new RulePackError("PACK_TERM_TOO_LONG", `${what} has a term that is too long`);
  }
}

/** The pack in the order-free form that is hashed. */
function hashForm(p: RulePackJson): unknown {
  const sortBy = <T>(xs: T[], key: (x: T) => string): T[] =>
    [...xs].sort((a, b) => cmpCodePoints(key(a), key(b)));
  return {
    ...p,
    rules: sortBy(p.rules, (r) => r.id).map((r) =>
      r.kind === "terms" ? { ...r, terms: [...r.terms].sort(cmpCodePoints) } : r,
    ),
    dictionaries: sortBy(p.dictionaries, (d) => d.name).map((d) => ({
      ...d,
      terms: [...d.terms].sort(cmpCodePoints),
    })),
    neutralise_literals: [...p.neutralise_literals].sort(cmpCodePoints),
  };
}

export function packHash(p: RulePackJson): string {
  return createHash("sha256")
    .update(canonicalize(hashForm(p)), "utf8")
    .digest("hex");
}

export function loadRulePack(json: unknown): RulePack {
  const p = parseRulePackShape(json);
  if (p.rules.length === 0) throw new RulePackError("PACK_NO_RULES", "the pack has no rules");
  for (const c of BUILTIN_CATEGORIES) {
    if (!(c in p.categories)) {
      throw new RulePackError("PACK_UNDECLARED_CATEGORY", `the pack does not declare ${c}`);
    }
  }
  const categories = new Map(Object.entries(p.categories));
  const patternRules: CompiledPatternRule[] = [];
  const termRules: CompiledTermsRule[] = [];
  const ids = new Set<string>();
  for (const r of p.rules) {
    if (ids.has(r.id)) throw new RulePackError("PACK_DUPLICATE_ID", `duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (!ACTIONS.includes(r.action as Action)) {
      throw new RulePackError("PACK_UNKNOWN_ACTION", `rule ${r.id} has an unknown action`);
    }
    if (!categories.has(r.category)) {
      throw new RulePackError(
        "PACK_UNDECLARED_CATEGORY",
        `rule ${r.id} uses an undeclared category`,
      );
    }
    if (r.kind === "pattern") {
      const seen = new Set<string>();
      for (const ch of r.flags) {
        if (!(FLAG_CHARS as readonly string[]).includes(ch) || seen.has(ch)) {
          throw new RulePackError("PACK_UNKNOWN_FLAG", `rule ${r.id} has an unknown flag`);
        }
        seen.add(ch);
      }
      if (!EDGES.includes(r.edges as Edges)) {
        throw new RulePackError("PACK_UNKNOWN_EDGE", `rule ${r.id} has an unknown edge value`);
      }
      const validators = r.validators.map((name) => {
        const fn = Object.prototype.hasOwnProperty.call(VALIDATORS, name)
          ? VALIDATORS[name]
          : undefined;
        if (fn === undefined) {
          throw new RulePackError(
            "PACK_UNKNOWN_VALIDATOR",
            `rule ${r.id} names an unknown validator`,
          );
        }
        return { name, fn };
      });
      const { re, hasCapture } = compilePattern(r.pattern, r.flags);
      const rule: CompiledPatternRule = {
        id: r.id,
        category: r.category,
        action: r.action as Action,
        edges: r.edges as Edges,
        validators,
        re,
        hasCapture,
      };
      if (r.variant !== undefined) rule.variant = r.variant;
      patternRules.push(rule);
    } else {
      checkTerms(r.terms, `rule ${r.id}`);
      const rule: CompiledTermsRule = {
        id: r.id,
        category: r.category,
        action: r.action as Action,
        set: buildTermSet(r.id, r.terms),
      };
      if (r.variant !== undefined) rule.variant = r.variant;
      termRules.push(rule);
    }
  }
  const names = new Set<string>();
  for (const d of p.dictionaries) {
    if (names.has(d.name))
      throw new RulePackError("PACK_DUPLICATE_ID", `duplicate dictionary ${d.name}`);
    names.add(d.name);
    if (d.category !== `dictionary.${d.name}`) {
      throw new RulePackError("PACK_SCHEMA", `dictionary ${d.name} has the wrong category`);
    }
    if (!categories.has(d.category)) {
      throw new RulePackError(
        "PACK_UNDECLARED_CATEGORY",
        `dictionary ${d.name} uses an undeclared category`,
      );
    }
    if (!d.template.includes("{n}")) {
      throw new RulePackError("PACK_NO_FAKE", `dictionary ${d.name} has no usable fake value`);
    }
    checkTerms(d.terms, `dictionary ${d.name}`);
    termRules.push({
      id: d.category,
      category: d.category,
      action: "redact",
      set: buildTermSet(d.category, d.terms),
    });
  }
  const ruleset: Ruleset = {
    patternRules,
    termRules,
    literals: [...new Set(p.neutralise_literals)].sort(cmpCodePoints),
  };
  for (const [cat, decl] of categories) {
    if (!surrogateIsValid(decl.surrogate) || !surrogateIsUsable(decl.surrogate, ruleset)) {
      throw new RulePackError("PACK_NO_FAKE", `category ${cat} has no usable fake value`);
    }
  }
  return {
    name: p.name,
    version: p.version,
    hash: packHash(p),
    categories,
    ruleset,
  };
}

/**
 * Loads a profile against its pack: every key names a declared category, optionally with a
 * variant (`category/variant`); every value is a known action.
 */
export function loadProfile(json: unknown, pack: RulePack): Profile {
  const p = parseProfileShape(json);
  const actions = new Map<string, Action>();
  for (const [key, value] of Object.entries(p.actions)) {
    if (!ACTIONS.includes(value as Action)) {
      throw new RulePackError("PROFILE_UNKNOWN_ACTION", `${key} has an unknown action`);
    }
    const slash = key.indexOf("/");
    const category = slash < 0 ? key : key.slice(0, slash);
    if (slash >= 0 && !/^[a-z0-9_]+$/.test(key.slice(slash + 1))) {
      throw new RulePackError("PROFILE_SCHEMA", `${key} has a malformed variant`);
    }
    if (!pack.categories.has(category)) {
      throw new RulePackError("PROFILE_UNDECLARED_CATEGORY", `${key} names an undeclared category`);
    }
    actions.set(key, value as Action);
  }
  return { name: p.name, actions };
}
