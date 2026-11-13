// Provides the result's serialisation (§2.10): keys in a fixed order, no insignificant white
// space, so that results compare byte for byte. A result or a refusal goes in; compact JSON
// comes out. No part of a result holds removed text, a term, or input text except a distillate.
import type {
  Counters,
  DistillRefusal,
  DistillResult,
  Finding,
  Provenance,
  Removal,
} from "./schema";
import { cmpCodePoints } from "./util";

function counters(c: Counters): Counters {
  return {
    evaluated: c.evaluated,
    candidates: c.candidates,
    rejected_edge: c.rejected_edge,
    rejected_validator: c.rejected_validator,
    fired: c.fired,
  };
}

function provenance(p: Provenance): Provenance {
  const sorted: Record<string, Counters> = {};
  for (const k of Object.keys(p.counters).sort(cmpCodePoints)) {
    sorted[k] = counters(p.counters[k] as Counters);
  }
  return {
    rulepack: { name: p.rulepack.name, version: p.rulepack.version, hash: p.rulepack.hash },
    profile: p.profile,
    engine: { name: p.engine.name, version: p.engine.version, unicode: p.engine.unicode },
    certified: p.certified,
    counters: sorted,
  };
}

function removal(r: Removal): Removal {
  const o: Removal = {
    segment: r.segment,
    start: r.start,
    end: r.end,
    category: r.category,
    rule: r.rule,
    fake: r.fake,
  };
  if (r.variant === undefined) return o;
  return {
    segment: r.segment,
    start: r.start,
    end: r.end,
    category: r.category,
    variant: r.variant,
    rule: r.rule,
    fake: r.fake,
  };
}

function finding(f: Finding): Finding {
  if (f.variant === undefined) {
    return {
      segment: f.segment,
      start: f.start,
      end: f.end,
      category: f.category,
      rule: f.rule,
      action: f.action,
    };
  }
  return {
    segment: f.segment,
    start: f.start,
    end: f.end,
    category: f.category,
    variant: f.variant,
    rule: f.rule,
    action: f.action,
  };
}

/** The result as a value whose keys are in the order of the specification. */
export function orderedResult(r: DistillResult | DistillRefusal): unknown {
  if ("error" in r) return { error: { code: r.error.code, message: r.error.message } };
  if (r.blocked !== undefined) {
    return {
      mode: r.mode,
      blocked: { category: r.blocked.category, rule: r.blocked.rule },
      provenance: provenance(r.provenance),
    };
  }
  return {
    mode: r.mode,
    segments: (r.segments ?? []).map((s) => ({ id: s.id, distillate: s.distillate })),
    removals: (r.removals ?? []).map(removal),
    findings: (r.findings ?? []).map(finding),
    warnings: (r.warnings ?? []).map((w) =>
      w.segment === undefined ? { code: w.code } : { code: w.code, segment: w.segment },
    ),
    provenance: provenance(r.provenance),
  };
}

export function serializeResult(r: DistillResult | DistillRefusal): string {
  return JSON.stringify(orderedResult(r));
}
