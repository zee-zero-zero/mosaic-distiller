// Provides the engine (§2.1): `createEngine` binds a loaded rule pack and profiles; `distill`
// runs the order of work of §2.1 over a request and returns a result or a refusal; `capabilities`
// reports what §4.3 lists. Any exception inside `distill` is a refusal, `INTERNAL`, and the
// engine never returns the original text in place of a distillate (§2.11, "Fail closed").
import { actionFor, neutraliseMarker } from "./actions";
import { buildDistillate, type Op } from "./distillate";
import { FakeAllocator, surrogateIsUsable } from "./fakes";
import { mergeHits, type Span } from "./resolve";
import { countersFor, detect } from "./pattern/scan";
import { ENGINE_VERSION, PACKAGE_NAME } from "./name";
import {
  LIMITS,
  RequestError,
  parseRequestShape,
  refusal,
  type Action,
  type CategoryDecl,
  type DistillRefusal,
  type DistillRequest,
  type DistillResult,
  type Finding,
  type Removal,
  type Warning,
} from "./schema";
import { fromCodePoints } from "./text/codepoints";
import { buildScanView, mapSpanToOriginal, type ScanView } from "./text/scanview";
import { buildTermSet, foldTerm } from "./terms";
import { cmpCodePoints, utf8Length } from "./util";
import type { CompiledTermsRule, Hit, Profile, RulePack, Ruleset } from "./types";

export interface Capabilities {
  modes: string[];
  profiles: { names: string[]; default: string };
  rulepack: { name: string; version: string; hash: string };
  engine: { name: string; version: string; unicode: string };
  categories: Record<string, string>;
  limits: {
    segments: { min: number; max: number };
    segment_id_length: { min: number; max: number };
    total_bytes: number;
    dictionaries: number;
    terms: number;
    term_length: { min: number; max: number };
  };
  certified: boolean;
}

export interface Engine {
  distill(req: DistillRequest): DistillResult | DistillRefusal;
  capabilities(): Capabilities;
}

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const SEGMENT_ID = /^[A-Za-z0-9._-]+$/;
const DICTIONARY_NAME = /^[a-z0-9_]+$/;

function unicodeVersion(): string {
  const p = (globalThis as { process?: { versions?: { unicode?: string } } }).process;
  return p?.versions?.unicode ?? "unknown";
}

/** The canonical form of a value: two hits are the same value when these are equal (§2.8). */
function canonical(span: Span, text: string): string {
  const w = span.winner;
  if (w.term !== undefined && w.start === span.start && w.end === span.end) return w.term;
  if (w.category === "contact.email") return text.toLowerCase();
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) {
      if (c >= 0x61 && c <= 0x7a) out += String.fromCharCode(c - 32);
      else if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a)) out += ch;
    } else if (LETTER_OR_DIGIT.test(ch)) {
      out += ch;
    }
  }
  return out;
}

interface Resolved {
  si: number;
  span: Span;
  action: Action;
  /** Original code-point range. */
  start: number;
  end: number;
}

class EngineImpl implements Engine {
  constructor(
    private readonly pack: RulePack,
    private readonly profiles: Map<string, Profile>,
    private readonly defaultProfile: string,
  ) {}

  capabilities(): Capabilities {
    const categories: Record<string, string> = {};
    for (const k of [...this.pack.categories.keys()].sort(cmpCodePoints)) {
      categories[k] = (this.pack.categories.get(k) as CategoryDecl).class;
    }
    return {
      modes: ["rules"],
      profiles: {
        names: [...this.profiles.keys()].sort(cmpCodePoints),
        default: this.defaultProfile,
      },
      rulepack: { name: this.pack.name, version: this.pack.version, hash: this.pack.hash },
      engine: { name: PACKAGE_NAME, version: ENGINE_VERSION, unicode: unicodeVersion() },
      categories,
      limits: {
        segments: { ...LIMITS.segments },
        segment_id_length: { ...LIMITS.segmentIdLength },
        total_bytes: LIMITS.totalBytes,
        dictionaries: LIMITS.dictionaries,
        terms: LIMITS.terms,
        term_length: { ...LIMITS.termLength },
      },
      certified: false,
    };
  }

  distill(req: DistillRequest): DistillResult | DistillRefusal {
    try {
      return this.run(req);
    } catch (e) {
      if (e instanceof RequestError) return refusal(e.code);
      return refusal("INTERNAL");
    }
  }

  private isDefend(category: string): boolean {
    return this.pack.categories.get(category)?.class === "defend";
  }

  private run(raw: DistillRequest): DistillResult | DistillRefusal {
    const req = parseRequestShape(raw);
    // Validation, in this order (§2.11): mode, profile, segments, ids, dictionaries, terms, size.
    if (req.mode !== undefined && req.mode !== "rules") throw new RequestError("UNSUPPORTED_MODE");
    const profile = this.profiles.get(req.profile ?? this.defaultProfile);
    if (profile === undefined) throw new RequestError("UNKNOWN_PROFILE");
    if (req.segments.length < LIMITS.segments.min) throw new RequestError("EMPTY_INPUT");
    if (req.segments.length > LIMITS.segments.max) throw new RequestError("TOO_MANY_SEGMENTS");
    const ids = new Set<string>();
    for (const s of req.segments) {
      if (
        s.id.length < LIMITS.segmentIdLength.min ||
        s.id.length > LIMITS.segmentIdLength.max ||
        !SEGMENT_ID.test(s.id)
      ) {
        throw new RequestError("INVALID_ARGUMENTS");
      }
      if (ids.has(s.id)) throw new RequestError("DUPLICATE_SEGMENT_ID");
      ids.add(s.id);
    }
    const dictionaries = req.dictionaries ?? [];
    if (dictionaries.length > LIMITS.dictionaries) throw new RequestError("TOO_MANY_DICTIONARIES");
    const packDictionaries = new Set(this.pack.ruleset.termRules.map((t) => t.id));
    const names = new Set<string>();
    let termCount = 0;
    for (const d of dictionaries) {
      if (
        d.name.length < LIMITS.dictionaryNameLength.min ||
        d.name.length > LIMITS.dictionaryNameLength.max ||
        !DICTIONARY_NAME.test(d.name) ||
        names.has(d.name) ||
        packDictionaries.has(`dictionary.${d.name}`) ||
        (d.template !== undefined && !d.template.includes("{n}")) ||
        // A template whose every fake some rule hits (such as `<use_tool {n}`) could never be
        // allocated; it is refused here, as the loader refuses the same in a pack.
        (d.template !== undefined && !surrogateIsUsable(d.template, this.pack.ruleset))
      ) {
        throw new RequestError("INVALID_ARGUMENTS");
      }
      names.add(d.name);
      termCount += d.terms.length;
    }
    if (termCount > LIMITS.terms) throw new RequestError("TOO_MANY_TERMS");
    for (const d of dictionaries) {
      for (const t of d.terms) {
        const n = foldTerm(t).length;
        if (n < LIMITS.termLength.min) throw new RequestError("TERM_TOO_SHORT");
        if (n > LIMITS.termLength.max) throw new RequestError("TERM_TOO_LONG");
      }
    }
    let bytes = 0;
    for (const s of req.segments) bytes += utf8Length(s.text);
    if (bytes > LIMITS.totalBytes) throw new RequestError("INPUT_TOO_LARGE");

    // The rules of this request: the pack's, and the caller's dictionaries.
    const extraSurrogates = new Map<string, string>();
    const requestTerms: CompiledTermsRule[] = dictionaries.map((d) => {
      const category = `dictionary.${d.name}`;
      extraSurrogates.set(category, d.template ?? "Term {n}");
      return { id: category, category, action: "redact", set: buildTermSet(category, d.terms) };
    });
    const ruleset: Ruleset = {
      patternRules: this.pack.ruleset.patternRules,
      termRules: [...this.pack.ruleset.termRules, ...requestTerms],
      literals: this.pack.ruleset.literals,
    };

    // 2-3. Scan views and hits.
    const counters = countersFor(ruleset);
    const views: ScanView[] = req.segments.map((s) => buildScanView(s.text));
    const redactSpans: Span[][] = [];
    const defendSpans: Span[][] = [];
    views.forEach((view) => {
      const hits = detect(ruleset, view, counters);
      const plain: Hit[] = [];
      const defend: Hit[] = [];
      for (const h of hits) (this.isDefend(h.category) ? defend : plain).push(h);
      // 4. Overlaps. Defend hits are resolved separately.
      redactSpans.push(mergeHits(plain));
      defendSpans.push(mergeHits(defend));
    });

    // 5. Actions.
    const resolved: Resolved[] = [];
    views.forEach((view, si) => {
      for (const span of [...(redactSpans[si] as Span[]), ...(defendSpans[si] as Span[])]) {
        const [start, end] = mapSpanToOriginal(view, span.start, span.end);
        resolved.push({ si, span, action: actionFor(profile, span.winner), start, end });
      }
    });
    const order = (a: Resolved, b: Resolved): number =>
      a.si - b.si ||
      a.start - b.start ||
      a.end - b.end ||
      cmpCodePoints(a.span.winner.rule, b.span.winner.rule);
    resolved.sort(order);
    const invisibleAction = actionFor(profile, {
      start: 0,
      end: 0,
      rule: "hidden.invisible",
      category: "hidden.invisible",
      action: "flag",
    });
    const provenance = {
      rulepack: { name: this.pack.name, version: this.pack.version, hash: this.pack.hash },
      profile: profile.name,
      engine: { name: PACKAGE_NAME, version: ENGINE_VERSION, unicode: unicodeVersion() },
      certified: false,
      counters: Object.fromEntries([...counters].sort((a, b) => cmpCodePoints(a[0], b[0]))),
    };
    const blocking = resolved.find((r) => r.action === "block");
    if (blocking !== undefined) {
      return {
        mode: "rules",
        blocked: { category: blocking.span.winner.category, rule: blocking.span.winner.rule },
        provenance,
      };
    }
    if (invisibleAction === "block" && views.some((v) => v.runs.length > 0)) {
      return {
        mode: "rules",
        blocked: { category: "hidden.invisible", rule: "hidden.invisible" },
        provenance,
      };
    }

    // 6. Fakes, numbered by first occurrence: segments in order, then start in the original text.
    const allocator = new FakeAllocator(
      ruleset,
      this.pack.categories,
      req.segments.map((s) => s.text),
      extraSurrogates,
    );
    const removals: Removal[] = [];
    const findings: Finding[] = [];
    const ops: Op[][] = views.map(() => []);
    for (const r of resolved) {
      const view = views[r.si] as ScanView;
      const w = r.span.winner;
      const segment = (req.segments[r.si] as { id: string }).id;
      if (r.action === "redact") {
        const text = fromCodePoints(view.cps, r.span.start, r.span.end);
        const fake = allocator.allocate(w.category, w.variant, canonical(r.span, text), text);
        const rec: Removal = {
          segment,
          start: r.start,
          end: r.end,
          category: w.category,
          rule: w.rule,
          fake,
        };
        if (w.variant !== undefined) rec.variant = w.variant;
        removals.push(rec);
        (ops[r.si] as Op[]).push({ start: r.start, end: r.end, replacement: fake, redact: true });
      } else {
        const rec: Finding = {
          segment,
          start: r.start,
          end: r.end,
          category: w.category,
          rule: w.rule,
          action: r.action,
        };
        if (w.variant !== undefined) rec.variant = w.variant;
        findings.push(rec);
        if (r.action === "neutralise") {
          (ops[r.si] as Op[]).push({
            start: r.start,
            end: r.end,
            replacement: neutraliseMarker(w.category),
            redact: false,
          });
        }
      }
    }
    const warnings: Warning[] = [];
    views.forEach((view, si) => {
      const segment = (req.segments[si] as { id: string }).id;
      if (view.lone) warnings.push({ code: "LONE_SURROGATE", segment });
      for (const run of view.runs) {
        findings.push({
          segment,
          start: run.start,
          end: run.end,
          category: "hidden.invisible",
          rule: "hidden.invisible",
          action: invisibleAction,
        });
      }
    });

    // 7. Distillates.
    const segments = views.map((view, si) => ({
      id: (req.segments[si] as { id: string }).id,
      distillate: buildDistillate(view, ops[si] as Op[]),
    }));

    // 8. Records, sorted by segment order, start, end, rule.
    const segIndex = new Map(req.segments.map((s, i) => [s.id, i]));
    const sortRecords = <T extends { segment: string; start: number; end: number; rule: string }>(
      xs: T[],
    ): T[] =>
      xs.sort(
        (a, b) =>
          (segIndex.get(a.segment) as number) - (segIndex.get(b.segment) as number) ||
          a.start - b.start ||
          a.end - b.end ||
          cmpCodePoints(a.rule, b.rule),
      );
    return {
      mode: "rules",
      segments,
      removals: sortRecords(removals),
      findings: sortRecords(findings),
      warnings,
      provenance,
    };
  }
}

export interface EngineOptions {
  pack: RulePack;
  profiles: Profile[];
  defaultProfile: string;
}

export function createEngine(opts: EngineOptions): Engine {
  const profiles = new Map(opts.profiles.map((p) => [p.name, p]));
  if (!profiles.has(opts.defaultProfile))
    throw new Error("the default profile is not among the profiles");
  return new EngineImpl(opts.pack, profiles, opts.defaultProfile);
}
