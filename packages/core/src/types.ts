// Provides the types of the compiled form of a rule pack (what the engine runs), of a profile,
// and of a hit (one thing a rule found in the scan view of one segment).
import type { TermSet } from "./terms";
import type { Validator } from "./validators/types";
import type { Action, CategoryDecl, Counters, Edges } from "./schema";

export interface CompiledPatternRule {
  id: string;
  category: string;
  variant?: string;
  action: Action;
  edges: Edges;
  validators: { name: string; fn: Validator }[];
  re: RegExp;
  hasCapture: boolean;
}

export interface CompiledTermsRule {
  /** The rule id and category's counter key, e.g. `dictionary.contacts`. */
  id: string;
  category: string;
  variant?: string;
  action: Action;
  set: TermSet;
}

/** Everything the scan needs. A request adds its own dictionaries to the pack's. */
export interface Ruleset {
  patternRules: CompiledPatternRule[];
  termRules: CompiledTermsRule[];
  /** The neutralise literals, sorted by code point. */
  literals: string[];
}

export interface RulePack {
  name: string;
  version: string;
  hash: string;
  categories: Map<string, CategoryDecl>;
  ruleset: Ruleset;
}

export interface Profile {
  name: string;
  /** Keys are `category` or `category/variant`. */
  actions: Map<string, Action>;
}

/** One thing a rule found, in scan-view code-point coordinates. */
export interface Hit {
  start: number;
  end: number;
  rule: string;
  category: string;
  variant?: string;
  /** The rule's default action. */
  action: Action;
  /** Set for neutralise literals, which no profile can change. */
  forced?: Action;
  /** For term hits, the folded term: the same value gets the same fake. */
  term?: string;
}

export type CountersMap = Map<string, Counters>;

export function newCounters(): Counters {
  return { evaluated: 0, candidates: 0, rejected_edge: 0, rejected_validator: 0, fired: 0 };
}
