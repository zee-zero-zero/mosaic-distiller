// Tests of the engine as a whole, one mechanism at a time: overlaps (ENG-7), same value same fake
// (ENG-8), fakes that skip taken values (ENG-9), actions and profiles (ENG-16), structural limits
// (ENG-19), a typical paragraph (ENG-25), the §2.10 example byte for byte, blocking, refusals and
// capabilities.
import { describe, expect, it } from "vitest";
import { createEngine, loadProfile, loadRulePack, serializeResult } from "../src/index";
import { LIMITS } from "../src/schema";
import {
  defaultEngine,
  defaultPack,
  distillText,
  packJson,
  profileJson,
  readJson,
  smallEngine,
} from "./helpers";
import { loadRuleCases } from "./pack.test";

const agent = defaultEngine("agent");
const documentEngine = defaultEngine("document");

function code(r: any): string | undefined {
  return r.error?.code;
}

describe("ENG-7 overlaps resolve as §2.6 says", () => {
  it("a credential URL containing an e-mail address: one span, the longer hit's category", () => {
    const r = distillText(agent, "https://jane.doe@northwind-mail.com:pw@repo.example/x");
    expect(r.removals).toHaveLength(1);
    expect(r.removals[0].category).toBe("contact.email");
    expect(r.provenance.counters["secret.url_credential"].fired).toBe(1);
    expect(r.provenance.counters["contact.email"].fired).toBe(1);
  });
  it("an Authorization: Bearer header: one span, the header's value, masked once", () => {
    const r = distillText(agent, "Authorization: Bearer abcdefgh12345678");
    expect(r.removals).toHaveLength(1);
    expect(r.removals[0].category).toBe("secret.auth_header");
    expect(r.segments[0].distillate).toBe("Authorization: ***");
  });
  it("a value matched by two secret rules is masked once", () => {
    const r = distillText(agent, "password=abcdef123456 https://x.example/?password=abcdef123456");
    expect(r.segments[0].distillate).toBe("password=*** https://x.example/?password=***");
  });
  const two = (a: any, b: any) => smallEngine([a, b]);
  it("two touching values of different categories are merged into one span", () => {
    const e = two(
      { id: "x.letters", pattern: "[a-z]{3}" },
      { id: "y.digits", pattern: "[0-9]{3}" },
    );
    const r = distillText(e, "abc123");
    expect(r.removals).toHaveLength(1);
    expect([r.removals[0].start, r.removals[0].end]).toEqual([0, 6]);
  });
  it("the longest hit gives the category", () => {
    const e = two(
      { id: "secret.short", pattern: "[a-z]{3}" },
      { id: "contact.long", pattern: "[a-z]{3}[0-9]{3}" },
    );
    const r = distillText(e, "abc123");
    expect(r.removals[0].category).toBe("contact.long");
  });
  it("a tie in length goes to the family order, whatever the rule ids", () => {
    const e = two(
      { id: "contact.aaa", pattern: "[a-z]{3}" },
      { id: "secret.zzz", pattern: "[a-z]{3}" },
    );
    expect(distillText(e, "abc").removals[0].category).toBe("secret.zzz");
    const f = two(
      { id: "network.k", pattern: "[a-z]{3}" },
      { id: "contact.k", pattern: "[a-z]{3}" },
    );
    expect(distillText(f, "abc").removals[0].category).toBe("contact.k");
  });
  it("a tie within a family goes to the rule id first in code-point order, whatever the file order", () => {
    for (const order of [0, 1]) {
      const rules = [
        { id: "gov_id.b", pattern: "[a-z]{3}" },
        { id: "gov_id.a", pattern: "[a-z]{3}" },
      ];
      if (order) rules.reverse();
      expect(distillText(smallEngine(rules), "abc").removals[0].rule).toBe("gov_id.a");
    }
  });
  it("code-point order, not UTF-16 order, breaks ties: U+FF21 sorts before U+10000", () => {
    const rules = [
      { id: "z.\u{10000}", pattern: "[a-z]{3}" },
      { id: "z.Ａ", pattern: "[a-z]{3}" },
    ];
    expect(distillText(smallEngine(rules), "abc").removals[0].rule).toBe("z.Ａ");
  });
  it("defend hits are resolved apart: a finding survives inside a redaction", () => {
    const e = smallEngine(
      [
        { id: "secret.k", pattern: "key=[a-z]{6}" },
        { id: "inject.tag", category: "inject.tag", pattern: "<b>", surrogate: "#{n}" },
      ],
      { "inject.tag": "flag" },
      {},
    );
    // inject.tag is declared medium in the helper, so declare it defend explicitly:
    const pack = packJson([
      { id: "secret.k", pattern: "key=[a-z]{6}<b>", surrogate: "mask" },
      { id: "inject.tag", pattern: "<b>", surrogate: "#{n}" },
    ]) as any;
    pack.categories["inject.tag"].class = "defend";
    const lp = loadRulePack(pack);
    const eng = createEngine({
      pack: lp,
      profiles: [loadProfile(profileJson({ "inject.tag": "flag" }), lp)],
      defaultProfile: "p",
    });
    const r = distillText(eng, "key=abcdef<b>");
    expect(r.removals).toHaveLength(1);
    expect(r.findings.map((f: any) => f.category)).toEqual(["inject.tag"]);
    expect(e).toBeDefined();
  });
  it("a neutralised defend span partly inside a redaction is covered by the redaction", () => {
    const pack = packJson([
      { id: "gov_id.k", pattern: "AA[0-9]{3}" },
      { id: "inject.tag", pattern: "[0-9]{3}BB", surrogate: "#{n}" },
    ]) as any;
    pack.categories["inject.tag"].class = "defend";
    const lp = loadRulePack(pack);
    const eng = createEngine({
      pack: lp,
      profiles: [loadProfile(profileJson({ "inject.tag": "neutralise" }), lp)],
      defaultProfile: "p",
    });
    const r = distillText(eng, "x AA123BB y");
    expect(r.segments[0].distillate).toBe("x 000-0 y".replace("000-0", r.removals[0].fake));
    expect(r.segments[0].distillate).not.toContain("BB");
    expect(r.segments[0].distillate).not.toContain("123");
  });
});

describe("ENG-8 same value, same fake", () => {
  const two = (a: string, b: string): any =>
    agent.distill({
      segments: [
        { id: "a", text: a },
        { id: "b", text: b },
      ],
    });
  it("one e-mail address in two segments, once in upper case: the same fake", () => {
    const r = two("write jane.doe@northwind-mail.com", "or JANE.DOE@NORTHWIND-MAIL.COM");
    expect(r.segments.map((s: any) => s.distillate)).toEqual([
      "write person1@example.com",
      "or person1@example.com",
    ]);
  });
  it("two different addresses: person1 and person2, in order of first occurrence", () => {
    const r = two("b@northwind-mail.com", "a@northwind-mail.com and b@northwind-mail.com");
    expect(r.segments.map((s: any) => s.distillate)).toEqual([
      "person1@example.com",
      "person2@example.com and person1@example.com",
    ]);
  });
  it("536-22-8914 written twice: one fake", () => {
    const r = two("536-22-8914", "again 536-22-8914");
    expect(r.segments.map((s: any) => s.distillate)).toEqual(["000-00-0001", "again 000-00-0001"]);
  });
  it("a card in two layouts is one value, and gets one fake in the first layout's shape", () => {
    const r = two("4111 1111 1111 1111", "4111-1111-1111-1111");
    expect(r.segments.map((s: any) => s.distillate)).toEqual([
      "0000 0000 0000 0001",
      "0000 0000 0000 0001",
    ]);
  });
  it("numbering is by first occurrence: segments in order, then position", () => {
    const r = two("x 536-22-8914 y 537-22-8914", "538-22-8914");
    expect(r.segments.map((s: any) => s.distillate)).toEqual([
      "x 000-00-0001 y 000-00-0002",
      "000-00-0003",
    ]);
  });
  it("numbering is per category", () => {
    const r = distillText(agent, "536-22-8914 jane@northwind-mail.com");
    expect(r.segments[0].distillate).toBe("000-00-0001 person1@example.com");
  });
  it("the removal's fake is the one in the distillate, and secrets are masked, not numbered", () => {
    const r = distillText(agent, "password=abcdef123456 and token: zyxwvu987654");
    expect(r.removals.map((x: any) => x.fake)).toEqual(["***", "***"]);
  });
  it("the same value found by two different rules of one category is one value", () => {
    const e = smallEngine([
      { id: "a.one", category: "a.v", pattern: "[0-9]{3}" },
      { id: "a.two", category: "a.v", pattern: "x[0-9]{3}" },
    ]);
    const r = distillText(e, "123 123");
    expect(r.segments[0].distillate).toBe("#1 #1");
  });
});

describe("ENG-9 fakes skip taken and caught values", () => {
  it("input already holding person1@example.com: the next free n", () => {
    const r = distillText(agent, "person1@example.com wrote to jane@northwind-mail.com");
    expect(r.segments[0].distillate).toBe("person1@example.com wrote to person2@example.com");
  });
  it("input already holding 000-00-0001: the next free n", () => {
    const r = distillText(agent, "ref 000-00-0001 for 536-22-8914");
    expect(r.segments[0].distillate).toBe("ref 000-00-0001 for 000-00-0002");
  });
  it("a fake that occurs only inside a longer word of the input is still skipped", () => {
    const r = distillText(agent, "xperson1@example.comx jane@northwind-mail.com");
    expect(r.segments[0].distillate).toContain("person2@example.com");
  });
  it("a fake in another segment of the request is skipped too", () => {
    const r: any = agent.distill({
      segments: [
        { id: "a", text: "person1@example.com" },
        { id: "b", text: "jane@northwind-mail.com" },
      ],
    });
    expect(r.segments[1].distillate).toBe("person2@example.com");
  });
  it("a category whose first fakes another rule would hit: the next free n", () => {
    const e = smallEngine([
      { id: "t.email", pattern: "jane@x\\.co", surrogate: "email" },
      { id: "t.catch", pattern: "person[1-2]@example\\.com", edges: "word" },
    ]);
    const r = distillText(e, "write jane@x.co");
    expect(r.segments[0].distillate).toBe("write person3@example.com");
  });
  it("fakes follow the §2.8 table", () => {
    const text = [
      "jane@northwind-mail.com",
      "(202) 456-1111",
      "52.94.236.248",
      "2a00:1450:4001:82a::200e",
      "00:1A:2B:3C:4D:5E",
      "K1A 0B1",
      "〒100-0001",
      "SW1A 1AA",
      "GB82 WEST 1234 5698 7654 32",
      "ghp_" + "abcdefghij".repeat(3),
      "1EG4-TE5-MK73",
    ].join(" | ");
    const r = distillText(agent, text);
    const fakes = Object.fromEntries(
      r.removals.map((x: any) => [x.category + (x.variant ? "/" + x.variant : ""), x.fake]),
    );
    expect(fakes["contact.email"]).toBe("person1@example.com");
    expect(fakes["contact.phone"]).toBe("(202) 555-0101");
    expect(fakes["network.ipv4"]).toBe("192.0.2.1");
    expect(fakes["network.ipv6"]).toBe("2001:db8::1");
    expect(fakes["network.mac"]).toBe("00:00:5e:00:53:01");
    expect(fakes["contact.postal_code/ca"]).toBe("D0D 0D1");
    expect(fakes["contact.postal_code/jp"]).toBe("000-0002");
    // n counts per category, so the third postal code seen gets n = 3.
    expect(fakes["contact.postal_code/gb"]).toBe("XX0X 3XX");
    expect(fakes["secret.vendor_key"]).toBe("***");
    expect(fakes["health_id.us_mbi"]).toBe("0XX0-XX0-XX01");
    expect(fakes["financial.iban"]).toBe("XX00 XXXX 0000 0000 0000 01");
  });
  it("the phone and address templates run out in the order §2.8 gives", () => {
    const phones = Array.from({ length: 101 }, (_, i) => `(202) 456-${String(1000 + i)}`);
    const r = distillText(agent, phones.join(" | "));
    const fakes: string[] = r.removals.map((x: any) => x.fake);
    expect(fakes[0]).toBe("(202) 555-0101");
    expect(fakes[98]).toBe("(202) 555-0199");
    expect(fakes[99]).toBe("(202) 555-0100 ext. 100");
    const ips = Array.from(
      { length: 300 },
      (_, i) => `52.${Math.floor(i / 250) + 1}.${(i % 250) + 1}.9`,
    );
    const ri = distillText(agent, ips.join(" "));
    const ifakes: string[] = ri.removals.map((x: any) => x.fake);
    expect(ifakes[0]).toBe("192.0.2.1");
    expect(ifakes[253]).toBe("192.0.2.254");
    expect(ifakes[254]).toBe("198.51.100.1");
  });
  it("a value with no digit to number falls back to a plain marker", () => {
    const e = smallEngine([{ id: "inject.x", pattern: "Human: ", surrogate: "shape" }]);
    expect(distillText(e, "Human: hi").segments[0].distillate).toBe("[redacted 1]hi");
  });
});

describe("ENG-16 actions and profiles", () => {
  const pack = defaultPack();
  const cases = loadRuleCases().filter((c) => c.expect === "hit");
  const categories = [...pack.categories.keys()].filter(
    (c) => c !== "hidden.invisible" && c !== "inject.consumer_markup",
  );
  /** One hit text per category whose hit is a distinct winner under the agent profile. */
  const sample = new Map<string, { text: string; variant?: string }>();
  for (const c of cases) {
    if (sample.has(c.category as string)) continue;
    const r: any = agent.distill({ segments: [{ id: "1", text: c.text }] });
    const recs = [...(r.removals ?? []), ...(r.findings ?? [])];
    if (recs.some((x: any) => x.category === c.category))
      sample.set(c.category as string, { text: c.text, variant: c.variant });
  }
  it("every category has a sample text", () => {
    for (const c of categories) expect(sample.has(c), c).toBe(true);
  });

  const withAction = (category: string, action: string): ReturnType<typeof createEngine> =>
    createEngine({
      pack,
      profiles: [loadProfile(profileJson({ [category]: action }), pack)],
      defaultProfile: "p",
    });

  for (const category of categories) {
    const s = sample.get(category);
    if (s === undefined) continue;
    describe(`category ${category}`, () => {
      it("redact -> a fake, recorded as a removal", () => {
        const r: any = distillText(withAction(category, "redact"), s.text);
        const rec = r.removals.find((x: any) => x.category === category);
        expect(rec, JSON.stringify(r.error)).toBeDefined();
        expect(r.segments[0].distillate).toContain(rec.fake);
        expect(r.segments[0].distillate).not.toBe(s.text);
      });
      it("flag -> kept, with a finding", () => {
        const r: any = distillText(withAction(category, "flag"), s.text);
        expect(r.removals.filter((x: any) => x.category === category)).toEqual([]);
        expect(r.findings.find((x: any) => x.category === category)?.action).toBe("flag");
        expect(r.segments[0].distillate).toBe(s.text);
      });
      it("neutralise -> the marker, with a finding", () => {
        const r: any = distillText(withAction(category, "neutralise"), s.text);
        expect(r.findings.find((x: any) => x.category === category)?.action).toBe("neutralise");
        expect(r.segments[0].distillate).toContain(`[neutralised: ${category}]`);
      });
      it("block -> no distillate, only the reason", () => {
        const r: any = distillText(withAction(category, "block"), s.text);
        expect(r.blocked).toEqual({ category, rule: r.blocked.rule });
        expect(r.segments).toBeUndefined();
        expect(r.removals).toBeUndefined();
        expect(r.findings).toBeUndefined();
        expect(r.provenance.profile).toBe("p");
      });
    });
  }

  describe("the built-in profiles follow the §2.7 table", () => {
    const expected = (
      profile: "agent" | "document",
      category: string,
      variant?: string,
    ): string => {
      const defend = pack.categories.get(category)?.class === "defend";
      if (
        profile === "agent" &&
        ["inject.special_token", "inject.tool_markup", "inject.md_image_remote"].includes(category)
      )
        return "neutralise";
      if (
        profile === "document" &&
        category === "network.ipv4" &&
        ["private", "loopback", "link_local"].includes(variant ?? "")
      )
        return "flag";
      return defend ? "flag" : "redact";
    };
    for (const profile of ["agent", "document"] as const) {
      for (const category of categories) {
        const s = sample.get(category);
        if (s === undefined) continue;
        it(`${profile}: ${category}`, () => {
          const r: any = distillText(defaultEngine(profile), s.text);
          const want = expected(profile, category, s.variant);
          const rec = [...r.removals, ...r.findings].find((x: any) => x.category === category);
          if (want === "redact")
            expect(r.removals.some((x: any) => x.category === category)).toBe(true);
          else expect(rec.action).toBe(want);
        });
      }
    }
    const ipv4: [string, string][] = [
      ["private", "10.0.0.5"],
      ["loopback", "127.0.0.1"],
      ["link_local", "169.254.10.20"],
      ["", "52.94.236.248"],
    ];
    for (const [variant, ip] of ipv4) {
      it(`network.ipv4 ${variant || "public"}: agent redacts; document ${variant ? "flags" : "redacts"}`, () => {
        const a: any = distillText(agent, ip);
        expect(a.removals).toHaveLength(1);
        const d: any = distillText(documentEngine, ip);
        if (variant) {
          expect(d.removals).toHaveLength(0);
          expect(d.findings[0]).toMatchObject({
            category: "network.ipv4",
            variant,
            action: "flag",
          });
        } else expect(d.removals).toHaveLength(1);
      });
    }
    it("the more specific key wins: category/variant over category", () => {
      const e = createEngine({
        pack,
        profiles: [
          loadProfile(
            profileJson({ "network.ipv4": "flag", "network.ipv4/private": "redact" }),
            pack,
          ),
        ],
        defaultProfile: "p",
      });
      expect(distillText(e, "10.0.0.5").removals).toHaveLength(1);
      expect(distillText(e, "52.94.236.248").removals).toHaveLength(0);
    });
  });

  describe("MosAIc's markup is neutralised under every profile", () => {
    const literals = ["<use_tool", "<mosaic_ui", '"__payment_required"'];
    const profiles: Record<string, ReturnType<typeof createEngine>> = {
      agent,
      document: documentEngine,
      flag: withAction("inject.consumer_markup", "flag"),
      redact: withAction("inject.consumer_markup", "redact"),
      block: withAction("inject.consumer_markup", "block"),
      neutralise: withAction("inject.consumer_markup", "neutralise"),
    };
    for (const [name, engine] of Object.entries(profiles)) {
      for (const lit of literals) {
        it(`${name}: ${lit}`, () => {
          const r: any = distillText(engine, `a ${lit} b`);
          expect(r.segments[0].distillate).toBe("a [neutralised: inject.consumer_markup] b");
          expect(r.findings[0]).toMatchObject({
            category: "inject.consumer_markup",
            action: "neutralise",
          });
        });
      }
    }
    it("the match is on the scan view: hidden characters and full-width forms do not hide a literal", () => {
      expect(distillText(agent, "<use​_tool").segments[0].distillate).toBe(
        "[neutralised: inject.consumer_markup]",
      );
      expect(distillText(agent, "＜use_tool").segments[0].distillate).toBe(
        "[neutralised: inject.consumer_markup]",
      );
    });
    it("the match is case-sensitive, as §2.2 says", () => {
      expect(distillText(agent, "<USE_TOOL").findings).toEqual([]);
    });
    it("the marker contains no literal, so running again finds nothing", () => {
      const once: any = distillText(agent, "x <use_tool y");
      const twice: any = distillText(agent, once.segments[0].distillate);
      expect(twice.segments[0].distillate).toBe(once.segments[0].distillate);
      expect(twice.findings).toEqual([]);
    });
  });

  describe("hidden.invisible follows the profile too", () => {
    it("flag (the default): deleted and reported", () => {
      const r: any = distillText(agent, "a​b");
      expect(r.findings).toEqual([
        {
          segment: "1",
          start: 1,
          end: 2,
          category: "hidden.invisible",
          rule: "hidden.invisible",
          action: "flag",
        },
      ]);
    });
    it("block: the request is blocked", () => {
      const r: any = distillText(withAction("hidden.invisible", "block"), "a​b");
      expect(r.blocked).toEqual({ category: "hidden.invisible", rule: "hidden.invisible" });
      expect(distillText(withAction("hidden.invisible", "block"), "ab").blocked).toBeUndefined();
    });
  });
});

describe("ENG-19 structural limits", () => {
  const tiny = smallEngine([{ id: "never.matches", pattern: "zzzzzzzz" }]);
  const seg = (n: number, text = "x"): any =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text }));
  it("no segments -> EMPTY_INPUT", () =>
    expect(code(tiny.distill({ segments: [] }))).toBe("EMPTY_INPUT"));
  it("an empty text -> an empty distillate", () => {
    const r: any = distillText(tiny, "");
    expect(r.segments).toEqual([{ id: "1", distillate: "" }]);
    expect(r.provenance.counters["never.matches"].evaluated).toBe(1);
  });
  it("duplicate ids -> DUPLICATE_SEGMENT_ID", () => {
    expect(
      code(
        tiny.distill({
          segments: [
            { id: "a", text: "" },
            { id: "a", text: "" },
          ],
        }),
      ),
    ).toBe("DUPLICATE_SEGMENT_ID");
  });
  it("a lone surrogate is replaced, with LONE_SURROGATE", () => {
    const r: any = distillText(tiny, "a\ud800b");
    expect(r.segments[0].distillate).toBe("a�b");
    expect(r.warnings).toEqual([{ code: "LONE_SURROGATE", segment: "1" }]);
  });
  it("a lone low surrogate and a surrogate pair split by text are handled", () => {
    expect(distillText(tiny, "\udc00").segments[0].distillate).toBe("�");
    expect(distillText(tiny, "😀").warnings).toEqual([]);
  });
  it(`segments: ${LIMITS.segments.max} passes, ${LIMITS.segments.max + 1} is refused with no partial result`, () => {
    expect(code(tiny.distill({ segments: seg(1000) }))).toBeUndefined();
    const over: any = tiny.distill({ segments: seg(1001) });
    expect(over).toEqual({ error: { code: "TOO_MANY_SEGMENTS", message: expect.any(String) } });
    expect(over.segments).toBeUndefined();
  });
  it("segment ids: 1 to 64 characters of [A-Za-z0-9._-]", () => {
    const ok = (id: string): boolean =>
      code(tiny.distill({ segments: [{ id, text: "" }] })) === undefined;
    expect(ok("a")).toBe(true);
    expect(ok("a".repeat(64))).toBe(true);
    expect(ok("A.b_c-9")).toBe(true);
    for (const bad of ["", "a".repeat(65), "a b", "é", "a/b", "a\n"]) {
      expect(code(tiny.distill({ segments: [{ id: bad, text: "" }] })), JSON.stringify(bad)).toBe(
        "INVALID_ARGUMENTS",
      );
    }
  });
  it("total text: exactly 1,048,576 UTF-8 bytes passes, one more is refused", () => {
    const max = LIMITS.totalBytes;
    expect(code(tiny.distill({ segments: [{ id: "1", text: "a".repeat(max) }] }))).toBeUndefined();
    expect(code(tiny.distill({ segments: [{ id: "1", text: "a".repeat(max + 1) }] }))).toBe(
      "INPUT_TOO_LARGE",
    );
  });
  it("the byte limit counts bytes, not characters, across segments", () => {
    const max = LIMITS.totalBytes;
    expect(
      code(tiny.distill({ segments: [{ id: "1", text: "é".repeat(max / 2) }] })),
    ).toBeUndefined();
    expect(code(tiny.distill({ segments: [{ id: "1", text: "é".repeat(max / 2 + 1) }] }))).toBe(
      "INPUT_TOO_LARGE",
    );
    expect(
      code(tiny.distill({ segments: [{ id: "1", text: "😀".repeat(max / 4) }] })),
    ).toBeUndefined();
    expect(code(tiny.distill({ segments: [{ id: "1", text: "😀".repeat(max / 4 + 1) }] }))).toBe(
      "INPUT_TOO_LARGE",
    );
    expect(
      code(
        tiny.distill({
          segments: [
            { id: "1", text: "a".repeat(max / 2) },
            { id: "2", text: "b".repeat(max / 2 + 1) },
          ],
        }),
      ),
    ).toBe("INPUT_TOO_LARGE");
  });
  const dicts = (n: number, terms = 2): any => ({
    segments: [{ id: "1", text: "x" }],
    dictionaries: Array.from({ length: n }, (_, i) => ({
      name: `d${i}`,
      terms: Array.from({ length: terms }, (_, j) => `term${i}x${j}`),
    })),
  });
  it("dictionaries: 20 pass, 21 are refused", () => {
    expect(code(tiny.distill(dicts(20)))).toBeUndefined();
    expect(code(tiny.distill(dicts(21)))).toBe("TOO_MANY_DICTIONARIES");
  });
  it("terms: 10,000 in all dictionaries pass, 10,001 are refused", () => {
    expect(code(tiny.distill(dicts(10, 1000)))).toBeUndefined();
    const over = dicts(10, 1000);
    over.dictionaries[0].terms.push("one more term");
    expect(code(tiny.distill(over))).toBe("TOO_MANY_TERMS");
  });
  const withTerm = (t: string): any => ({
    segments: [{ id: "1", text: "x" }],
    dictionaries: [{ name: "d", terms: [t] }],
  });
  it("a term: 2 code points pass, 1 is refused; 200 pass, 201 are refused (after folding)", () => {
    expect(code(tiny.distill(withTerm("ab")))).toBeUndefined();
    expect(code(tiny.distill(withTerm("a")))).toBe("TERM_TOO_SHORT");
    expect(code(tiny.distill(withTerm("́á")))).toBe("TERM_TOO_SHORT");
    expect(code(tiny.distill(withTerm("a".repeat(200))))).toBeUndefined();
    expect(code(tiny.distill(withTerm("a".repeat(201))))).toBe("TERM_TOO_LONG");
    expect(code(tiny.distill(withTerm("😀".repeat(200))))).toBeUndefined();
    expect(code(tiny.distill(withTerm("😀".repeat(201))))).toBe("TERM_TOO_LONG");
  });
  it("a term is measured after folding: a run of white space is one code point", () => {
    expect(code(tiny.distill(withTerm("a" + " ".repeat(300) + "b")))).toBeUndefined();
  });
  it("dictionary names and templates are checked", () => {
    const bad = (d: any): string | undefined =>
      code(tiny.distill({ segments: [{ id: "1", text: "" }], dictionaries: [d] }));
    expect(bad({ name: "", terms: [] })).toBe("INVALID_ARGUMENTS");
    expect(bad({ name: "A", terms: [] })).toBe("INVALID_ARGUMENTS");
    expect(bad({ name: "a".repeat(33), terms: [] })).toBe("INVALID_ARGUMENTS");
    expect(bad({ name: "a".repeat(32), terms: [] })).toBeUndefined();
    expect(bad({ name: "ok", terms: [], template: "no number" })).toBe("INVALID_ARGUMENTS");
    expect(
      code(
        tiny.distill({
          segments: [{ id: "1", text: "" }],
          dictionaries: [
            { name: "a", terms: [] },
            { name: "a", terms: [] },
          ],
        }),
      ),
    ).toBe("INVALID_ARGUMENTS");
  });
  it("unknown profile and unsupported mode", () => {
    expect(code(tiny.distill({ segments: [{ id: "1", text: "" }], profile: "strict" }))).toBe(
      "UNKNOWN_PROFILE",
    );
    expect(code(tiny.distill({ segments: [{ id: "1", text: "" }], mode: "summarise" }))).toBe(
      "UNSUPPORTED_MODE",
    );
    expect(
      code(tiny.distill({ segments: [{ id: "1", text: "" }], mode: "rules" })),
    ).toBeUndefined();
  });
  it("shape errors are INVALID_ARGUMENTS", () => {
    const bad: any[] = [
      null,
      5,
      "text",
      [],
      {},
      { segments: "x" },
      { segments: [5] },
      { segments: [{ id: "1" }] },
      { segments: [{ id: 1, text: "" }] },
      { segments: [{ id: "1", text: "", extra: 1 }] },
      { segments: [{ id: "1", text: "" }], extra: 1 },
      { segments: [{ id: "1", text: "" }], profile: 5 },
      { segments: [{ id: "1", text: "" }], objective: { kind: "play" } },
      { segments: [{ id: "1", text: "" }], dictionaries: {} },
    ];
    for (const b of bad) expect(code(tiny.distill(b)), JSON.stringify(b)).toBe("INVALID_ARGUMENTS");
  });
  it("the objective is accepted and changes nothing", () => {
    const a = serializeResult(tiny.distill({ segments: [{ id: "1", text: "x" }] }));
    const b = serializeResult(
      tiny.distill({
        segments: [{ id: "1", text: "x" }],
        objective: { kind: "task", task: "summarise" },
      }),
    );
    expect(b).toBe(a);
  });
  it("fail closed: an internal error is INTERNAL, with no distillate", () => {
    const hostile = {
      segments: [
        {
          id: "1",
          get text(): string {
            throw new Error("boom");
          },
        },
      ],
    };
    const r: any = tiny.distill(hostile as never);
    expect(r).toEqual({ error: { code: "INTERNAL", message: expect.any(String) } });
    expect(JSON.stringify(r)).not.toContain("boom");
  });
  it("every refusal's message is fixed and never quotes input", () => {
    const r: any = tiny.distill({ segments: [{ id: "SECRET ID", text: "" }] });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("ENG-25 a typical paragraph", () => {
  it("one paragraph with an e-mail address and a phone number, byte for byte", () => {
    const text =
      "Hi Dana, please call me on (202) 456-1111 or write to dana.k@northwind-mail.com before Friday. Thanks!";
    const r: any = distillText(agent, text);
    expect(r.segments[0].distillate).toBe(
      "Hi Dana, please call me on (202) 555-0101 or write to person1@example.com before Friday. Thanks!",
    );
    expect(r.removals.map((x: any) => [x.category, text.slice(x.start, x.end)])).toEqual([
      ["contact.phone", "(202) 456-1111"],
      ["contact.email", "dana.k@northwind-mail.com"],
    ]);
  });
});

describe("§2.10 the example, byte for byte", () => {
  const emailOnly = loadRulePack({
    ...(readJson("rulepacks/default.json") as any),
    categories: Object.fromEntries(
      Object.entries((readJson("rulepacks/default.json") as any).categories).filter(([k]) =>
        ["contact.email", "hidden.invisible", "inject.consumer_markup"].includes(k),
      ),
    ),
    rules: (readJson("rulepacks/default.json") as any).rules.filter(
      (r: any) => r.id === "contact.email",
    ),
  });
  const engine = createEngine({
    pack: emailOnly,
    profiles: [loadProfile({ format: "profile/1", name: "agent", actions: {} }, emailOnly)],
    defaultProfile: "agent",
  });
  it("matches the specification's JSON", () => {
    const out = serializeResult(
      engine.distill({ segments: [{ id: "1", text: "Write to jane.doe@northwind-mail.com." }] }),
    );
    const expected =
      '{"mode":"rules","segments":[{"id":"1","distillate":"Write to person1@example.com."}],' +
      '"removals":[{"segment":"1","start":9,"end":36,"category":"contact.email","rule":"contact.email","fake":"person1@example.com"}],' +
      '"findings":[],"warnings":[],"provenance":{"rulepack":{"name":"default","version":"0.1.0","hash":"' +
      emailOnly.hash +
      '"},"profile":"agent","engine":{"name":"mosaic-distiller","version":"0.1.0","unicode":"' +
      process.versions.unicode +
      '"},"certified":false,"counters":{"contact.email":{"evaluated":1,"candidates":1,"rejected_edge":0,"rejected_validator":0,"fired":1}}}}';
    expect(out).toBe(expected);
  });
});

describe("the result", () => {
  it("a blocked result has no segments, removals or findings, and the provenance", () => {
    const e = createEngine({
      pack: defaultPack(),
      profiles: [loadProfile(profileJson({ "contact.email": "block" }), defaultPack())],
      defaultProfile: "p",
    });
    const s = serializeResult(e.distill({ segments: [{ id: "1", text: "a@northwind-mail.com" }] }));
    const o = JSON.parse(s);
    expect(Object.keys(o)).toEqual(["mode", "blocked", "provenance"]);
    expect(o.blocked).toEqual({ category: "contact.email", rule: "contact.email" });
    expect(JSON.stringify(o)).not.toContain("northwind");
  });
  it("a blocked result names the first blocking span in order", () => {
    const e = createEngine({
      pack: defaultPack(),
      profiles: [
        loadProfile(
          profileJson({ "contact.email": "block", "gov_id.us_ssn": "block" }),
          defaultPack(),
        ),
      ],
      defaultProfile: "p",
    });
    const r: any = e.distill({
      segments: [
        { id: "1", text: "536-22-8914" },
        { id: "2", text: "a@northwind-mail.com" },
      ],
    });
    expect(r.blocked.category).toBe("gov_id.us_ssn");
  });
  it("keys are in the order of the specification, records are sorted, JSON is compact", () => {
    const r: any = agent.distill({
      segments: [
        { id: "b", text: "x 536-22-8914 a@northwind-mail.com" },
        { id: "a", text: "(202) 456-1111" },
      ],
    });
    const s = serializeResult(r);
    expect(s).not.toMatch(/\n| "|: /);
    const o = JSON.parse(s);
    expect(Object.keys(o)).toEqual([
      "mode",
      "segments",
      "removals",
      "findings",
      "warnings",
      "provenance",
    ]);
    expect(Object.keys(o.removals[0])).toEqual([
      "segment",
      "start",
      "end",
      "category",
      "rule",
      "fake",
    ]);
    expect(Object.keys(o.provenance)).toEqual([
      "rulepack",
      "profile",
      "engine",
      "certified",
      "counters",
    ]);
    // segment order is the order given (b, then a), then start
    expect(o.removals.map((x: any) => [x.segment, x.start])).toEqual([
      ["b", 2],
      ["b", 14],
      ["a", 0],
    ]);
    const names = Object.keys(o.provenance.counters);
    expect([...names].sort()).toEqual(names);
  });
  it("a variant is written after the category", () => {
    const o = JSON.parse(
      serializeResult(agent.distill({ segments: [{ id: "1", text: "K1A 0B1" }] })),
    );
    expect(Object.keys(o.removals[0])).toEqual([
      "segment",
      "start",
      "end",
      "category",
      "variant",
      "rule",
      "fake",
    ]);
  });
  it("a refusal serialises as {error:{code,message}}", () => {
    expect(serializeResult(agent.distill({ segments: [] }))).toBe(
      '{"error":{"code":"EMPTY_INPUT","message":"There is no text to distil."}}',
    );
  });
  it("certified is false and the engine reports its name, version and Unicode version", () => {
    const r: any = distillText(agent, "x");
    expect(r.provenance.certified).toBe(false);
    expect(r.provenance.engine).toEqual({
      name: "mosaic-distiller",
      version: "0.1.0",
      unicode: process.versions.unicode,
    });
  });
});

describe("capabilities", () => {
  const c = agent.capabilities();
  it("reports the modes, profiles, pack, engine, categories, limits and certification", () => {
    expect(c.modes).toEqual(["rules"]);
    expect(c.profiles).toEqual({ names: ["agent", "document"], default: "agent" });
    expect(c.rulepack).toEqual({ name: "default", version: "0.1.0", hash: defaultPack().hash });
    expect(c.engine.name).toBe("mosaic-distiller");
    expect(c.categories["gov_id.us_ssn"]).toBe("high");
    expect(c.categories["network.ipv4"]).toBe("medium");
    expect(c.certified).toBe(false);
    expect(c.limits).toMatchObject({ total_bytes: 1048576, dictionaries: 20, terms: 10000 });
    expect(Object.keys(c.categories)).toEqual([...Object.keys(c.categories)].sort());
  });
});
