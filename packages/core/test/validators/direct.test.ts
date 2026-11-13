// Direct tests of every validator (§3.5): the examples of §3.3 and §3.4 accepted and rejected as
// the specification says, a check character changed, the empty string, the longest input a
// pattern allows, adversarial strings, and a property that no validator throws on any string.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VALIDATORS, VALIDATOR_NAMES } from "../../src/validators";
import { RULES, runValidators } from "./fixtures";

const v = (name: string, text: string, after?: string) =>
  (VALIDATORS[name] as (s: string, a?: string) => { ok: boolean; variant?: string })(text, after);

describe("VAL-1 validator registry", () => {
  it("VAL-1 registry: holds every validator of §3.5 plus not_git and not_mask, frozen", () => {
    const expected = [
      "separators_consistent",
      "has_letter",
      "luhn",
      "ean13",
      "iban_mod97",
      "card_iin",
      "base58check",
      "bech32",
      "mrz_td3",
      "mrz_td2",
      "mrz_td1",
      "vin_na",
      "ssn_rules",
      "itin_rules",
      "ca_bn",
      "nanp_rules",
      "be_nn",
      "cz_rc",
      "es_dni",
      "es_nie",
      "fi_hetu",
      "fr_nir",
      "nino_prefix",
      "gb_dl_surname",
      "ie_pps",
      "it_cf",
      "no_fnr",
      "se_pnr",
      "eu_vat",
      "cn_ric",
      "cn_uscc",
      "hkid",
      "in_pan",
      "in_gstin",
      "kr_rrn",
      "sg_nric",
      "br_cpf",
      "br_cnpj",
      "mx_curp",
      "za_id",
      "email_shape",
      "ipv4_scope",
      "ipv6_parse",
      "mac_not_reserved",
      "not_git",
      "not_mask",
    ];
    expect([...VALIDATOR_NAMES].sort()).toEqual([...expected].sort());
    expect(Object.isFrozen(VALIDATORS)).toBe(true);
  });
});

describe("VAL-1 examples of §3 through each rule's validators", () => {
  for (const r of RULES) {
    for (const t of r.hit) {
      it(`VAL-1 hit ${r.rule}: ${JSON.stringify(t).slice(0, 50)}`, () => {
        expect(runValidators(r.validators, t)).toBe(true);
      });
    }
    for (const t of r.not) {
      it(`VAL-1 not-hit ${r.rule}: ${JSON.stringify(t).slice(0, 50)}`, () => {
        expect(runValidators(r.validators, t)).toBe(false);
      });
    }
    if (r.checkLast) {
      it(`VAL-1 check character changed ${r.rule}`, () => {
        for (const t of r.hit) {
          const last = t[t.length - 1] as string;
          const changed = t.slice(0, -1) + String((Number(last) + 1) % 10);
          expect(runValidators(r.validators, changed)).toBe(false);
        }
      });
    }
  }
});

describe("VAL-1 variants", () => {
  it("VAL-1 ipv4_scope sets private, loopback and link_local, and none for a public address", () => {
    expect(v("ipv4_scope", "10.1.2.3").variant).toBe("private");
    expect(v("ipv4_scope", "172.16.0.1").variant).toBe("private");
    expect(v("ipv4_scope", "172.31.255.255").variant).toBe("private");
    expect(v("ipv4_scope", "172.32.0.1").variant).toBeUndefined();
    expect(v("ipv4_scope", "192.168.1.1").variant).toBe("private");
    expect(v("ipv4_scope", "127.0.0.1").variant).toBe("loopback");
    expect(v("ipv4_scope", "169.254.0.9").variant).toBe("link_local");
    expect(v("ipv4_scope", "52.94.236.248").variant).toBeUndefined();
  });
  it("VAL-1 itin_rules, fi_hetu, base58check and bech32 set their variants", () => {
    expect(v("itin_rules", "912-93-4567")).toEqual({ ok: true, variant: "atin" });
    expect(v("itin_rules", "912-73-4567")).toEqual({ ok: true });
    expect(v("fi_hetu", "131052-308T").variant).toBeUndefined();
    expect(v("base58check", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").variant).toBe("btc");
    expect(v("base58check", "LT2KVaAy1ppRuxRgrS5RNU3vBsy7RibPeA").variant).toBe("ltc");
    expect(v("base58check", "DD4KSSuBJqcjuTcvUg1CgUKeurPUFeEZkE").variant).toBe("doge");
    expect(v("bech32", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").variant).toBe("btc");
    expect(v("bech32", "ltc1qhdhvrwe6rgqns8fz28tee0hphr5x7ulw5exv4w").variant).toBe("ltc");
  });
  it("VAL-1 fi_hetu marks an individual number of 900 or more temporary", () => {
    // 131052-900 with its check letter: 131052900 mod 31 = 25 -> 'T'? computed below.
    const alphabet = "0123456789ABCDEFHJKLMNPRSTUVWXY";
    const check = alphabet[131052900 % 31] as string;
    expect(v("fi_hetu", `131052-900${check}`)).toEqual({ ok: true, variant: "temporary" });
  });
});

describe("VAL-1 empty, long and adversarial inputs", () => {
  const acceptsEmpty = new Set(["separators_consistent", "not_git", "not_mask"]);
  for (const name of VALIDATOR_NAMES) {
    it(`VAL-1 ${name}: the empty string`, () => {
      const r = v(name, "");
      expect(r.ok).toBe(acceptsEmpty.has(name));
    });
    it(`VAL-1 ${name}: long and hostile inputs do not throw and are well formed`, () => {
      const inputs = [
        "9".repeat(100_000),
        "A".repeat(100_000),
        "-".repeat(1000) + "@" + ".".repeat(1000),
        "١٢٣-٤٥-٦٧٨٩",
        "５３６-２２-８９１４",
        "__proto__",
        "constructor",
        "\n\r\n\n",
        "\ud800",
        "a".repeat(64) + "@" + "b".repeat(63) + "." + "c".repeat(63),
      ];
      for (const t of inputs) {
        const r = v(name, t);
        expect(typeof r.ok).toBe("boolean");
        if (r.ok && r.variant !== undefined) expect(typeof r.variant).toBe("string");
      }
    });
  }
  it("VAL-1 non-ASCII digits and letters never pass a digit-based validator", () => {
    const hits = [
      ["ssn_rules", "٥٣٦-٢٢-٨٩١٤"],
      ["luhn", "٤١١١ ١١١١ ١١١١ ١١١١"],
      ["ipv4_scope", "٥٢.٩٤.٢٣٦.٢٤٨"],
      ["za_id", "٧٥٠٣٣٠٥٠٤٤٠٨٩"],
    ] as const;
    for (const [name, text] of hits) expect(v(name, text).ok).toBe(false);
  });
});

describe("VAL-1 never throws", () => {
  it("VAL-1 any string gives a well-formed answer from every validator", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 80 }), (s) => {
        for (const name of VALIDATOR_NAMES) {
          const r = v(name, s);
          if (typeof r.ok !== "boolean") return false;
          if (r.ok === false && "variant" in r) return false;
        }
        return true;
      }),
      { seed: 20261113, numRuns: 300 },
    );
  });
  it("VAL-1 strings shaped like each rule never throw", () => {
    const alphabet = fc.constantFrom(..."0123456789ABCXYZabc-.:/ ()@+<\n".split(""));
    fc.assert(
      fc.property(
        fc.array(alphabet, { maxLength: 60 }).map((a) => a.join("")),
        (s) => {
          for (const name of VALIDATOR_NAMES) v(name, s);
          return true;
        },
      ),
      { seed: 7, numRuns: 500 },
    );
  });
});

describe("VAL-1 adversarial cases per validator", () => {
  it("VAL-1 separators_consistent: mixed, doubled and paren separators", () => {
    expect(v("separators_consistent", "4111-1111 1111-1111").ok).toBe(false);
    expect(v("separators_consistent", "4111  1111").ok).toBe(true);
    expect(v("separators_consistent", "1 (202) 456-1111").ok).toBe(true);
    expect(v("separators_consistent", "1-202-456-1111").ok).toBe(true);
    expect(v("separators_consistent", "1-202 456-1111").ok).toBe(false);
    expect(v("separators_consistent", "202 456.1111").ok).toBe(false);
    // the separator after a leading country code is not compared with the others
    expect(v("separators_consistent", "+1 202-456-1111").ok).toBe(true);
  });
  it("VAL-1 has_letter: digits only, a non-Latin letter", () => {
    expect(v("has_letter", "1234567890").ok).toBe(false);
    expect(v("has_letter", "1234Ж").ok).toBe(true);
  });
  it("VAL-1 luhn and card_iin: wrong lengths and prefixes", () => {
    expect(v("luhn", "0").ok).toBe(true);
    expect(v("luhn", "no digits").ok).toBe(false);
    expect(v("card_iin", "4111111111111").ok).toBe(true); // Visa, 13 digits
    expect(v("card_iin", "41111111111111").ok).toBe(false); // 14 digits, Visa not allowed
    expect(v("card_iin", "6221260000000000").ok).toBe(true);
    expect(v("card_iin", "6229260000000000").ok).toBe(false);
    expect(v("card_iin", "2221000000000000").ok).toBe(true);
    expect(v("card_iin", "2721000000000000").ok).toBe(false);
    expect(v("card_iin", "35280000000000000000").ok).toBe(false); // 20 digits
  });
  it("VAL-1 iban_mod97: wrong country length and unknown country", () => {
    expect(v("iban_mod97", "GB82WEST12345698765432").ok).toBe(true);
    expect(v("iban_mod97", "GB82 WEST 1234 5698 7654 3").ok).toBe(false);
    expect(v("iban_mod97", "XX82WEST12345698765432").ok).toBe(false);
    expect(v("iban_mod97", "gb82west12345698765432").ok).toBe(false);
  });
  it("VAL-1 base58check and bech32 each judge only their own shape", () => {
    expect(v("base58check", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").ok).toBe(false);
    expect(v("bech32", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").ok).toBe(false);
    expect(v("bech32", "BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ").ok).toBe(true);
    expect(v("bech32", "Bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").ok).toBe(false);
    expect(v("bech32", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx").ok).toBe(false);
    // a Bech32m (BIP 350) taproot address, version 1
    expect(v("bech32", "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").ok).toBe(
      true,
    );
  });
  it("VAL-1 mrz: line count, lengths, CRLF", () => {
    const td3 = RULES.find((r) => r.rule === "gov_id.mrz.td3")!.hit[0] as string;
    expect(v("mrz_td3", td3.replace("\n", "\r\n")).ok).toBe(true);
    expect(v("mrz_td3", td3.replace("\n", "")).ok).toBe(false);
    expect(v("mrz_td3", td3 + "\n").ok).toBe(false);
    expect(v("mrz_td2", td3).ok).toBe(false);
    expect(v("mrz_td1", td3).ok).toBe(false);
    const td3Bad = td3.replace("L898902C3", "L898902C4");
    expect(v("mrz_td3", td3Bad).ok).toBe(false);
  });
  it("VAL-1 vin_na: position 10, letters and digits, wrong length", () => {
    expect(v("vin_na", "1M8GDM9AXKP04278").ok).toBe(false);
    expect(v("vin_na", "1M8GDM9AXKP0427888").ok).toBe(false);
    expect(v("vin_na", "11111111111111111").ok).toBe(false); // the check digit is right, but no letter
  });
  it("VAL-1 ssn_rules and itin_rules: boundaries", () => {
    expect(v("ssn_rules", "899-99-9999").ok).toBe(true);
    expect(v("ssn_rules", "900-99-9999").ok).toBe(false);
    expect(v("ssn_rules", "001-01-0001").ok).toBe(true);
    expect(v("itin_rules", "900-50-0000").ok).toBe(true);
    expect(v("itin_rules", "900-49-0000").ok).toBe(false);
    expect(v("itin_rules", "900-65-0000").ok).toBe(true);
    expect(v("itin_rules", "900-66-0000").ok).toBe(false);
    expect(v("itin_rules", "900-69-0000").ok).toBe(false);
    expect(v("itin_rules", "900-70-0000").ok).toBe(true);
    expect(v("itin_rules", "900-88-0000").ok).toBe(true);
    expect(v("itin_rules", "900-89-0000").ok).toBe(false);
    expect(v("itin_rules", "900-92-0000").ok).toBe(true);
    expect(v("itin_rules", "900-94-0000").ok).toBe(true);
    expect(v("itin_rules", "900-99-0000").ok).toBe(true);
  });
  it("VAL-1 nanp_rules: N11 and the fictional range edges", () => {
    expect(v("nanp_rules", "202-555-0099").ok).toBe(true);
    expect(v("nanp_rules", "202-555-0100").ok).toBe(false);
    expect(v("nanp_rules", "202-555-0199").ok).toBe(false);
    expect(v("nanp_rules", "202-555-0200").ok).toBe(true);
    expect(v("nanp_rules", "202-456-1111").ok).toBe(true);
    expect(v("nanp_rules", "211-456-1111").ok).toBe(false);
    expect(v("nanp_rules", "202-911-1111").ok).toBe(false);
    expect(v("nanp_rules", "2-456-1111").ok).toBe(false);
    expect(v("nanp_rules", "2202-456-1111").ok).toBe(false);
  });
  it("VAL-1 email_shape: the ssh remote needs the text after the match", () => {
    expect(v("email_shape", "git@github.com", ":org/repo.git").ok).toBe(false);
    expect(v("email_shape", "git@github.com", " is a host").ok).toBe(true);
    expect(v("email_shape", "git@github.com").ok).toBe(false);
    expect(v("email_shape", "jane@a.b").ok).toBe(false); // top-level label of one letter
    expect(v("email_shape", "jane@a.co").ok).toBe(true);
    expect(v("email_shape", "jane@a.c1").ok).toBe(false);
    expect(v("email_shape", "jane@EXAMPLE.COM").ok).toBe(false);
    expect(v("email_shape", "jane@notexample.com").ok).toBe(true);
    expect(v("email_shape", "jane@x.png").ok).toBe(false);
    expect(v("email_shape", "a@b@c.com").ok).toBe(false);
  });
  it("VAL-1 ipv6_parse: shape of the :: and group counts", () => {
    expect(v("ipv6_parse", "1:2:3:4:5:6:7:8").ok).toBe(true);
    expect(v("ipv6_parse", "1:2:3:4:5:6:7::").ok).toBe(true);
    expect(v("ipv6_parse", "1:2:3:4:5:6:7:8::").ok).toBe(false);
    expect(v("ipv6_parse", "::1:2:3").ok).toBe(true);
    expect(v("ipv6_parse", ":::").ok).toBe(false);
    expect(v("ipv6_parse", "12345::1:2").ok).toBe(false);
    expect(v("ipv6_parse", "2001:0db8::1:2").ok).toBe(false);
    expect(v("ipv6_parse", "2001:db9::1:2").ok).toBe(true);
  });
  it("VAL-1 not_git and not_mask: the masked and unmasked forms", () => {
    expect(v("not_git", "https://git@").ok).toBe(false);
    expect(v("not_git", "https://gitlab@").ok).toBe(true);
    expect(v("not_git", "https://user:git@").ok).toBe(true);
    expect(v("not_mask", "password=***").ok).toBe(false);
    expect(v("not_mask", "password=**").ok).toBe(true);
    expect(v("not_mask", "password=a***").ok).toBe(true);
    expect(v("not_mask", "?token=***").ok).toBe(false);
    expect(v("not_mask", "Authorization: Bearer ***").ok).toBe(false);
    expect(v("not_mask", "https://***@").ok).toBe(false);
    expect(v("not_mask", "x***").ok).toBe(true);
  });
  it("VAL-1 eu_vat: unknown country, wrong shapes, spaces ignored after the prefix", () => {
    expect(v("eu_vat", "DE 136695976").ok).toBe(true);
    expect(v("eu_vat", "DE1366959760").ok).toBe(false);
    expect(v("eu_vat", "NL 004495445 B 01").ok).toBe(true);
    expect(v("eu_vat", "").ok).toBe(false);
    expect(v("eu_vat", "D").ok).toBe(false);
  });
});
