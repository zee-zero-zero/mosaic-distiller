// Tests over the segment pool: the guard (ENG-2), nothing a rule matched survives (ENG-1),
// records hold no removed text (ENG-3), running twice changes nothing (ENG-10), large and hostile
// input stays fast (ENG-20), and determinism under shuffled rules and terms (ENG-21).
import { describe, expect, it } from "vitest";
import { createEngine, loadProfile, loadRulePack, serializeResult } from "../src/index";
import { scanPatternRule } from "../src/pattern/scan";
import { buildScanView } from "../src/text/scanview";
import {
  bestMs,
  defaultEngine,
  defaultPack,
  distillText,
  isFullTier,
  readJson,
  smallEngine,
  timeScale,
} from "./helpers";
import { loadRuleCases } from "./pack.test";
import {
  POOL_KINDS,
  carriesContent,
  forbiddenFourGrams,
  generatePool,
  requestFor,
  seededShuffle,
  type PoolMember,
} from "./pool/generate";

const pool = generatePool();
const quickSample = pool.filter((_, i) => i % 5 === 0);
const members = isFullTier() ? pool : quickSample;
const engine = defaultEngine("agent");
const cps = (s: string): string[] => Array.from(s);

const run = (m: PoolMember, e = engine): any => e.distill(requestFor(m));

describe("ENG-2 the pool keeps its hostile members", () => {
  it("the pool has about 200 members", () => {
    expect(pool.length).toBeGreaterThanOrEqual(180);
    expect(pool.length).toBeLessThanOrEqual(260);
  });
  for (const kind of POOL_KINDS) {
    it(`ENG-2 has members of kind ${kind}`, () => {
      expect(pool.filter((m) => m.kinds.includes(kind)).length).toBeGreaterThanOrEqual(
        kind === "none" ? 5 : 5,
      );
    });
  }
  it("ENG-2 plants every redactable category of the pack", () => {
    const planted = new Set(pool.flatMap((m) => m.planted.map((p) => p.category)));
    const pack = defaultPack();
    const categories = [...pack.categories.entries()]
      .filter(([, d]) => d.class !== "defend")
      .map(([c]) => c);
    for (const c of categories) expect(planted.has(c), c).toBe(true);
    expect(planted.has("dictionary.names")).toBe(true);
  });
  it("ENG-2 has members with several categories, adjacent values and invisible characters actually present", () => {
    expect(pool.some((m) => new Set(m.planted.map((p) => p.category)).size >= 3)).toBe(true);
    expect(pool.some((m) => m.kinds.includes("adjacent") && m.planted.length >= 3)).toBe(true);
    expect(
      pool
        .filter((m) => m.kinds.includes("invisible"))
        .every((m) => /[\u200b\u2060\u00ad\u202e\ufeff\u200c]/.test(m.text)),
    ).toBe(true);
    expect(
      pool.filter((m) => m.kinds.includes("start")).every((m) => (m.planted[0] as any).start === 0),
    ).toBe(true);
    expect(
      pool
        .filter((m) => m.kinds.includes("end"))
        .every((m) => (m.planted.at(-1) as any).end === cps(m.text).length),
    ).toBe(true);
    expect(
      pool
        .filter((m) => m.kinds.includes("non-latin"))
        .every((m) => Array.from(m.text).some((c) => (c.codePointAt(0) as number) > 0x24f)),
    ).toBe(true);
    expect(pool.filter((m) => m.kinds.includes("none")).every((m) => m.planted.length === 0)).toBe(
      true,
    );
  });
  it("ENG-2 the pool is a pure function of its seed", () => {
    expect(generatePool()).toEqual(pool);
    expect(generatePool(1)).not.toEqual(pool);
  });
});

describe("ENG-1 nothing a rule matched survives", () => {
  for (const m of members) {
    it(`ENG-1 ${m.id} (${m.kinds.join(",")})`, () => {
      const r = run(m);
      expect(r.error, JSON.stringify(r.error)).toBeUndefined();
      // The removals are exactly the planted spans.
      const expected = m.planted.map((p) => [p.category, p.start, p.end]);
      const got = r.removals.map((x: any) => [x.category, x.start, x.end]);
      expect(got).toEqual(expected);
      // Every planted value is gone from the distillate, and its fake is in.
      const text = cps(m.text);
      const distillate: string = r.segments[0].distillate;
      for (const p of m.planted) {
        const value = text
          .slice(p.start, p.end)
          .join("")
          .replace(/[\u200b\u2060\u00ad\u202e\ufeff\u200c]/g, "");
        if (cps(value).length >= 4) expect(distillate).not.toContain(value);
      }
      for (const x of r.removals) if (x.fake !== "***") expect(distillate).toContain(x.fake);
      // Rebuilding the distillate from the records gives the same text.
      let rebuilt = "";
      let pos = 0;
      for (const x of r.removals) {
        rebuilt +=
          text
            .slice(pos, x.start)
            .join("")
            .replace(/[\u200b\u2060\u00ad\u202e\ufeff\u200c]/g, "") + x.fake;
        pos = x.end;
      }
      rebuilt += text
        .slice(pos)
        .join("")
        .replace(/[\u200b\u2060\u00ad\u202e\ufeff\u200c]/g, "");
      expect(distillate).toBe(rebuilt);
    });
  }
});

describe("ENG-10 running twice changes nothing", () => {
  for (const m of members) {
    it(`ENG-10 ${m.id}`, () => {
      const once = run(m);
      const text = once.segments[0].distillate;
      const twice = engine.distill({ ...requestFor(m), segments: [{ id: m.id, text }] }) as any;
      expect(twice.segments[0].distillate).toBe(text);
      expect(twice.removals).toEqual([]);
    });
  }
});

describe("ENG-10 running twice changes nothing: a rule that would catch a fake", () => {
  it("ENG-10 a fake that another rule hits is never used, so the distillate is stable", () => {
    const e = smallEngine([
      { id: "t.email", pattern: "jane@x\\.co", surrogate: "email" },
      { id: "t.catch", pattern: "person[1-2]@example\\.com", edges: "word" },
    ]);
    const once = distillText(e, "write jane@x.co");
    const twice = distillText(e, once.segments[0].distillate);
    expect(twice.segments[0].distillate).toBe(once.segments[0].distillate);
    expect(twice.removals).toEqual([]);
  });
  it("ENG-10 a fake that occurs in the input is never reused, so one value is never mistaken for another", () => {
    const text = "person1@example.com and jane@northwind-mail.com";
    const once = distillText(engine, text);
    const twice = distillText(engine, once.segments[0].distillate);
    expect(once.segments[0].distillate).toBe("person1@example.com and person2@example.com");
    expect(twice.removals).toEqual([]);
  });
});

describe("ENG-3 records hold no removed text", () => {
  const forbidden = forbiddenFourGrams();
  it("no field of any removal or finding contains any 4-character substring of a removed value", () => {
    for (const m of members) {
      const r = run(m);
      const text = cps(m.text);
      for (const rec of [...r.removals, ...r.findings]) {
        const value = text.slice(rec.start, rec.end);
        const grams = new Set<string>();
        for (let i = 0; i + 4 <= value.length; i++) {
          const g = value.slice(i, i + 4).join("");
          if (carriesContent(g)) grams.add(g);
        }
        const fields = [
          rec.segment,
          rec.category,
          rec.variant ?? "",
          rec.rule,
          rec.fake ?? "",
          rec.action ?? "",
        ];
        for (const f of fields) {
          for (const g of grams)
            expect(f.includes(g), `${m.id}: ${JSON.stringify(f)} holds ${JSON.stringify(g)}`).toBe(
              false,
            );
        }
      }
      // The whole serialised result outside the distillate holds no removed value either.
      const s = JSON.stringify({ ...r, segments: undefined });
      for (const p of m.planted) {
        const value = text.slice(p.start, p.end).join("");
        if (value.length >= 8 && p.category !== "dictionary.names")
          expect(s.includes(value)).toBe(false);
      }
    }
    expect(forbidden.size).toBeGreaterThan(100);
  });
});

describe("ENG-21 output is deterministic", () => {
  it("the pool run twice, with rules, categories, literals and terms shuffled, gives identical bytes", () => {
    const base = readJson("rulepacks/default.json") as any;
    const shuffled = {
      ...base,
      rules: seededShuffle(base.rules, 7),
      categories: Object.fromEntries(seededShuffle(Object.entries(base.categories), 8)),
      neutralise_literals: seededShuffle(base.neutralise_literals, 9),
    };
    const pack2 = loadRulePack(shuffled);
    expect(pack2.hash).toBe(defaultPack().hash);
    const profiles = ["agent", "document"].map((n) =>
      loadProfile(readJson(`profiles/${n}.json`), pack2),
    );
    const engine2 = createEngine({ pack: pack2, profiles, defaultProfile: "agent" });
    let i = 0;
    for (const m of members) {
      const a = serializeResult(engine.distill(requestFor(m)));
      const b = serializeResult(engine2.distill(requestFor(m, ++i)));
      expect(b, m.id).toBe(a);
    }
  });
  it("the same request twice gives the same bytes", () => {
    const m = pool[3] as PoolMember;
    expect(serializeResult(run(m))).toBe(serializeResult(run(m)));
  });
});

// ---- ENG-20 ----------------------------------------------------------------------------------

function denseText(bytes: number): string {
  const parts: string[] = [];
  let n = 0;
  let i = 0;
  while (n < bytes) {
    const piece = `user${i}x@qzx-wvk.net 52.${(i % 250) + 1}.${((i >> 4) % 250) + 1}.9 ghp_${"abcdefghij".repeat(3)}abcd${i % 10} 536-22-${String(1000 + (i % 8999))} password=hunter${i}zz\n`;
    parts.push(piece);
    n += piece.length;
    i++;
  }
  return parts.join("").slice(0, bytes);
}

describe("ENG-20 large and hostile input stays fast", () => {
  const big = isFullTier() ? 1_048_576 : 65_536;
  const bigBudget = (isFullTier() ? 2000 : 600) * timeScale();
  it(`${big} bytes dense with matches finish in under ${bigBudget} ms`, () => {
    const text = denseText(big);
    const { ms, value: r } = bestMs(() => engine.distill({ segments: [{ id: "1", text }] }) as any);
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    expect(r.removals.length).toBeGreaterThan(big / 400);
    expect(ms).toBeLessThan(bigBudget);
  });
  it("a 1 MB input with no match at all finishes in under 2 s", () => {
    const text = ("lorem ipsum dolor sit amet, consectetur " as string)
      .repeat(Math.ceil(big / 40))
      .slice(0, big);
    const { ms, value: r } = bestMs(() => engine.distill({ segments: [{ id: "1", text }] }) as any);
    expect(r.removals).toEqual([]);
    expect(ms).toBeLessThan((isFullTier() ? 2000 : 600) * timeScale());
  });
  const hostileSize = 32_768; // 32 KiB at every tier (§5.3)
  const rules = loadRuleCases().filter((c) => c.expect === "hit");
  const byRule = new Map<string, string[]>();
  for (const c of rules) byRule.set(c.rule, [...(byRule.get(c.rule) ?? []), c.text]);
  const pack = defaultPack();
  for (const rule of pack.ruleset.patternRules) {
    it(`ENG-20 ${rule.id}: backtracking inputs finish in under 100 ms`, () => {
      const hits = byRule.get(rule.id) ?? [];
      const sample = hits[0] ?? "a";
      const inputs: string[] = [];
      const fill = (unit: string): string =>
        unit.repeat(Math.ceil(hostileSize / Math.max(1, unit.length))).slice(0, hostileSize);
      inputs.push(fill(sample)); // the hit repeated, glued together
      inputs.push(fill(sample.slice(0, -1))); // the hit missing its last character, repeated
      inputs.push(fill(sample.slice(0, Math.max(1, Math.floor(sample.length / 2))))); // half of it, repeated
      inputs.push(fill(sample[0] as string)); // its first character, repeated
      inputs.push(fill(sample.slice(0, -1) + " ")); // missing the last character, with a space
      inputs.push(fill(sample + sample.slice(0, -1) + " ")); // a hit, then a near miss
      for (const text of inputs) {
        const view = buildScanView(text);
        const { ms } = bestMs(() => scanPatternRule(rule, view, null));
        expect(ms, `${rule.id} on ${JSON.stringify(text.slice(0, 30))}`).toBeLessThan(
          100 * timeScale(),
        );
      }
    });
  }
});
