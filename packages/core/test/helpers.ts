// Provides what the core tests share: reading the repository's data files, the default engine,
// small test packs built from a few rules (so each mechanism is tested directly and not only
// through the default pack), and the tier switch (quick, local or full).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEngine, loadProfile, loadRulePack } from "../src/index";
import type { Engine } from "../src/index";
import type { RulePack } from "../src/types";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(ROOT + rel, "utf8"));
}

export type Tier = "quick" | "local" | "full";
export function tier(): Tier {
  const t = process.env.DISTILLER_TIER;
  return t === "local" || t === "full" ? t : "quick";
}
/** True in the local and full tiers, where the full pools and budgets apply. */
export function isFullTier(): boolean {
  return tier() !== "quick";
}

let cached: { pack: RulePack; engines: Map<string, Engine> } | undefined;

function defaults(): { pack: RulePack; engines: Map<string, Engine> } {
  if (cached === undefined) {
    const pack = loadRulePack(readJson("rulepacks/default.json"));
    const profiles = ["agent", "document"].map((n) =>
      loadProfile(readJson(`profiles/${n}.json`), pack),
    );
    const engines = new Map<string, Engine>();
    cached = { pack, engines };
    for (const d of ["agent", "document"]) {
      engines.set(d, createEngine({ pack, profiles, defaultProfile: d }));
    }
  }
  return cached;
}

export function defaultPack(): RulePack {
  return defaults().pack;
}
/** The engine over the default pack and both built-in profiles. */
export function defaultEngine(defaultProfile: "agent" | "document" = "agent"): Engine {
  return defaults().engines.get(defaultProfile) as Engine;
}

export interface TestRule {
  id: string;
  category?: string;
  pattern?: string;
  flags?: string;
  edges?: string;
  validators?: string[];
  action?: string;
  variant?: string;
  /** The category's fake-value template; the default is `#{n}`. */
  surrogate?: string;
}

/** A pack JSON holding the given pattern rules, with every category declared. */
export function packJson(
  rules: TestRule[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const categories: Record<string, { class: string; surrogate: string }> = {
    "hidden.invisible": { class: "defend", surrogate: "shape" },
    "inject.consumer_markup": { class: "defend", surrogate: "shape" },
  };
  const full = rules.map((r) => {
    const category = r.category ?? r.id;
    if (!(category in categories))
      categories[category] = { class: "medium", surrogate: r.surrogate ?? "#{n}" };
    const out: Record<string, unknown> = {
      id: r.id,
      category,
      kind: "pattern",
      pattern: r.pattern ?? "x",
      flags: r.flags ?? "",
      edges: r.edges ?? "none",
      validators: r.validators ?? [],
      action: r.action ?? "redact",
    };
    if (r.variant !== undefined) out.variant = r.variant;
    return out;
  });
  return {
    format: "rulepack/1",
    name: "test",
    version: "0.0.1",
    categories,
    rules: full,
    dictionaries: [],
    neutralise_literals: [],
    ...extra,
  };
}

export function profileJson(actions: Record<string, string> = {}, name = "p"): unknown {
  return { format: "profile/1", name, actions };
}

/** An engine over a small pack. `actions` is the one profile `p`. */
export function smallEngine(
  rules: TestRule[],
  actions: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Engine {
  const pack = loadRulePack(packJson(rules, extra));
  return createEngine({
    pack,
    profiles: [loadProfile(profileJson(actions), pack)],
    defaultProfile: "p",
  });
}

/** Distils one text with the given engine and returns the result object (not serialised). */
export function distillText(engine: Engine, text: string, more: Record<string, unknown> = {}): any {
  return engine.distill({ segments: [{ id: "1", text }], ...more } as never);
}

/**
 * Runs `fn` up to `runs` times and returns the shortest wall-clock time in milliseconds, with the
 * last value. Other test files running at the same moment can only add time, never remove it, so
 * the shortest of a few runs is the fair measure of a budget (§5.1, "Budgets").
 */
export function bestMs<T>(fn: () => T, runs = 3): { ms: number; value: T } {
  let best = Infinity;
  let value: T | undefined;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    value = fn();
    best = Math.min(best, performance.now() - t0);
  }
  return { ms: best, value: value as T };
}
