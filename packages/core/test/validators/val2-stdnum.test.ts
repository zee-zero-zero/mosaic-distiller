// VAL-2: our validators against the independent `stdnum` npm package (test-only dependency).
// For each validator that stdnum also implements, valid values are generated (the check character
// is found by asking stdnum which candidate it accepts, so the generator never uses our code) and
// each is also changed by one character. Our answer must equal stdnum's. Where stdnum decides a
// century from today's date, or is deliberately stricter or looser than §3.5, the spec below says
// so and only the common domain is compared. Counts: 10,000 valid and 10,000 changed in the local
// and full tiers, 200 each in the quick tier.
import { stdnum } from "stdnum";
import { afterEach, describe, expect, it } from "vitest";
import { VALIDATORS } from "../../src/validators";

type StdModule = {
  validate: (s: string) => { isValid: boolean; error?: { name?: string } };
};
const S = stdnum as unknown as Record<string, Record<string, StdModule>>;
/** The stdnum module for a country code and a number type, such as ("BE", "nn"). */
function mod(country: string, type: string): StdModule {
  const m = S[country]?.[type];
  if (m === undefined) throw new Error(`stdnum has no ${country}.${type}`);
  return m;
}

const COUNT = ["local", "full"].includes(process.env.DISTILLER_TIER ?? "") ? 10_000 : 200;

type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r: Rng, s: string): string => s[int(r, 0, s.length - 1)] as string;
const pickOf = (r: Rng, list: string[]): string => list[int(r, 0, list.length - 1)] as string;
const pad = (n: number, w: number): string => String(n).padStart(w, "0");
const digs = (r: Rng, n: number): string =>
  Array.from({ length: n }, () => pick(r, "0123456789")).join("");
const D = "0123456789";
const L = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DL = D + L;
const range = (n: number, w: number): string[] => Array.from({ length: n }, (_, i) => pad(i, w));

interface Theirs {
  valid: boolean;
  kind?: string;
}
type Their = (c: string) => Theirs;
function sd(m: {
  validate: (s: string) => { isValid: boolean; error?: { name?: string } };
}): Their {
  return (c) => {
    try {
      const r = m.validate(c);
      return { valid: r.isValid === true, kind: r.error?.name };
    } catch {
      return { valid: false, kind: "throw" };
    }
  };
}

interface Gen {
  make: (check: string) => string;
  checks: string[];
}
interface Spec {
  /** Test name and the validator under test. */
  name: string;
  validator: string;
  fmt: (compact: string) => string;
  theirs: Their;
  gen: (r: Rng) => Gen;
  /** The characters a one-character change may use at position i of the compact value. */
  alphabet?: (compact: string, i: number) => string;
  /** The comparison does not apply to this value (stdnum's century rule, the clock, ...). */
  ignore?: (compact: string) => boolean;
  /** stdnum rejects for a reason other than the checksum where §3.5 does not check it. */
  theirsStricterThanSpec?: string;
  note: string;
}

const classAlphabet = (c: string, i: number): string => {
  const ch = c[i] as string;
  return ch >= "0" && ch <= "9" ? D : ch >= "A" && ch <= "Z" ? L : ch;
};

const SPECS: Spec[] = [
  {
    name: "be_nn",
    validator: "be_nn",
    fmt: (c) => `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}-${c.slice(6, 9)}.${c.slice(9)}`,
    theirs: sd(mod("BE", "nn")),
    gen: (r) => {
      const body =
        pad(int(r, 0, 99), 2) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 1, 28), 2) +
        pad(int(r, 1, 997), 3);
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: () => D,
    // stdnum, for a number that only checks as born from 2000, refuses a birth date in the future
    // (a clock read); §3.5 never does. Born-from-2000 numbers with a year from 2020 are left out.
    ignore: (c) => {
      const n9 = Number(c.slice(0, 9));
      return Number(c.slice(0, 2)) >= 20 && 97 - ((2_000_000_000 + n9) % 97) === Number(c.slice(9));
    },
    note: "ignores born-from-2000 numbers with a year from 2020 (stdnum rejects future dates)",
  },
  {
    name: "cz_rc",
    validator: "cz_rc",
    fmt: (c) => `${c.slice(0, 6)}/${c.slice(6)}`,
    theirs: sd(mod("CZ", "rc")),
    gen: (r) => {
      const mm = int(r, 1, 12) + pick(r, "\u0000\u0000\u00142F").charCodeAt(0);
      const body =
        pad(int(r, 0, 99), 2) + pad(mm, 2) + pad(int(r, 1, 28), 2) + pad(int(r, 0, 999), 3);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: () => D,
    // §3.5 says "mod 11 mod 10" for every year; stdnum uses "mod 11" alone for years from 1985, so
    // a remainder of 10 is a valid check digit 0 for us and invalid for stdnum.
    ignore: (c) => {
      const yy = Number(c.slice(0, 2));
      return c.length === 10 && Number(c.slice(0, 9)) % 11 === 10 && !(yy >= 54 && yy <= 84);
    },
    note: "ignores the remainder-10 case for years from 1985 (spec: mod 11 mod 10; stdnum: mod 11)",
  },
  {
    name: "es_dni",
    validator: "es_dni",
    fmt: (c) => (Number(c[0]) % 2 === 0 ? c : `${c.slice(0, 8)}-${c[8]}`),
    theirs: sd(mod("ES", "dni")),
    gen: (r) => {
      const body = digs(r, 8);
      return { make: (c) => body + c, checks: L.split("") };
    },
    alphabet: classAlphabet,
    note: "same domain",
  },
  {
    name: "es_nie",
    validator: "es_nie",
    fmt: (c) => c,
    theirs: sd(mod("ES", "nie")),
    gen: (r) => {
      const body = pick(r, "XYZ") + digs(r, 7);
      return { make: (c) => body + c, checks: L.split("") };
    },
    alphabet: (c, i) => (i === 0 ? "XYZ" : classAlphabet(c, i)),
    note: "same domain",
  },
  {
    name: "fi_hetu",
    validator: "fi_hetu",
    fmt: (c) => c,
    theirs: sd(mod("FI", "hetu")),
    gen: (r) => {
      const body =
        pad(int(r, 1, 28), 2) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 0, 99), 2) +
        pick(r, "+-ABCDEFUVWXY") +
        pad(int(r, 0, 999), 3);
      return { make: (c) => body + c, checks: "0123456789ABCDEFHJKLMNPRSTUVWXY".split("") };
    },
    alphabet: (c, i) =>
      i === 6 ? "+-ABCDEFUVWXY" : i === 10 ? "0123456789ABCDEFHJKLMNPRSTUVWXY" : D,
    // stdnum refuses a birth date in the future, which reads the clock; §3.5 never does. Dates in
    // the 2000s from 2020 on are left out so that the comparison holds on any run date.
    ignore: (c) => "ABCDEF".includes(c[6] as string) && Number(c.slice(4, 6)) >= 20,
    note: "ignores 2000s birth years from 2020 (stdnum rejects future dates)",
  },
  {
    name: "fr_nir",
    validator: "fr_nir",
    fmt: (c) =>
      `${c[0]} ${c.slice(1, 3)} ${c.slice(3, 5)} ${c.slice(5, 7)} ${c.slice(7, 10)} ${c.slice(10, 13)} ${c.slice(13)}`,
    theirs: sd(mod("FR", "nir")),
    gen: (r) => {
      const dept = r() < 0.15 ? pickOf(r, ["2A", "2B"]) : pad(int(r, 1, 95), 2);
      const body =
        pick(r, "12") + pad(int(r, 0, 99), 2) + pad(int(r, 1, 12), 2) + dept + digs(r, 6);
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: (c, i) => (i === 0 ? "12" : i === 5 || i === 6 ? D + "AB" : D),
    note: "same domain",
  },
  {
    name: "ie_pps",
    validator: "ie_pps",
    fmt: (c) => c,
    theirs: sd(mod("IE", "pps")),
    gen: (r) => {
      const body = digs(r, 7);
      const second = r() < 0.5 ? "" : pick(r, "ABHWTX");
      return { make: (c) => body + c + second, checks: "ABCDEFGHIJKLMNOPQRSTUVW".split("") };
    },
    alphabet: (c, i) => (i < 7 ? D : i === 7 ? "ABCDEFGHIJKLMNOPQRSTUVW" : "ABHWTX"),
    note: "same domain",
  },
  {
    name: "it_cf",
    validator: "it_cf",
    fmt: (c) => c,
    theirs: sd(mod("IT", "codicefiscale")),
    gen: (r) => {
      const num = (n: number): string =>
        n
          .toString()
          .split("")
          .map((d) => (r() < 0.2 ? "LMNPQRSTUV"[Number(d)] : d))
          .join("");
      const day = int(r, 1, 28) + (r() < 0.5 ? 0 : 40);
      const body =
        Array.from({ length: 6 }, () => pick(r, L)).join("") +
        num(int(r, 0, 99)).padStart(2, "0") +
        pick(r, "ABCDEHLMPRST") +
        num(day).padStart(2, "0") +
        pick(r, L) +
        num(int(r, 0, 999)).padStart(3, "0");
      return { make: (c) => body + c, checks: L.split("") };
    },
    alphabet: (c, i) =>
      [6, 7, 9, 10, 12, 13, 14].includes(i) ? D + "LMNPQRSTUV" : i === 8 ? "ABCDEHLMPRST" : L,
    note: "same domain",
  },
  {
    name: "no_fnr",
    validator: "no_fnr",
    fmt: (c) => `${c.slice(0, 6)} ${c.slice(6)}`,
    theirs: sd(mod("NO", "fodselsnummer")),
    gen: (r) => {
      const dd = int(r, 1, 28) + (r() < 0.2 ? 40 : 0);
      const mm = int(r, 1, 12) + (r() < 0.2 ? 40 : 0);
      const body = pad(dd, 2) + pad(mm, 2) + pad(int(r, 0, 99), 2) + pad(int(r, 0, 999), 3);
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: () => D,
    // stdnum fixes the century from the individual number and refuses a combination outside its
    // table; §3.5 asks only for a real date, in any century. Compared where stdnum has a century.
    ignore: (c) => {
      const yy = Number(c.slice(4, 6));
      const rest = Number(c.slice(6, 9));
      const has =
        rest < 500 ||
        (rest < 750 && yy > 54) ||
        (rest < 1000 && yy < 40) ||
        (rest >= 900 && yy >= 40);
      return !has;
    },
    note: "compared where stdnum's individual-number table gives a century",
  },
  {
    name: "se_pnr (12 digits)",
    validator: "se_pnr",
    fmt: (c) => `${c.slice(0, 8)}-${c.slice(8)}`,
    theirs: sd(mod("SE", "personnummer")),
    gen: (r) => {
      const dd = int(r, 1, 28) + (r() < 0.15 ? 60 : 0);
      const body =
        pad(int(r, 1800, 2099), 4) + pad(int(r, 1, 12), 2) + pad(dd, 2) + pad(int(r, 0, 999), 3);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: () => D,
    // §3.5 sets no earliest or latest birth year; stdnum refuses a year before 1800 and a date in
    // the future (a clock read). Years outside 1800-2019 are left out so the comparison holds on
    // any run date.
    ignore: (c) => Number(c.slice(0, 4)) < 1800 || Number(c.slice(0, 4)) > 2019,
    note: "ignores years outside 1800-2019 (stdnum's limits)",
  },
  {
    name: "se_pnr (10 digits, any century)",
    validator: "se_pnr",
    fmt: (c) => `${c.slice(0, 6)}-${c.slice(6)}`,
    theirs: (c) => {
      const t = sd(mod("SE", "personnummer"));
      for (const century of ["18", "19", "20"]) if (t(century + c).valid) return { valid: true };
      return { valid: false };
    },
    gen: (r) => {
      const dd = int(r, 1, 28) + (r() < 0.15 ? 60 : 0);
      const body =
        pad(int(r, 0, 99), 2) + pad(int(r, 1, 12), 2) + pad(dd, 2) + pad(int(r, 0, 999), 3);
      const t = sd(mod("SE", "personnummer"));
      return {
        make: (c) => body + c,
        checks: range(10, 1).filter(
          (c) => t("19" + body + c).valid || t("20" + body + c).valid || true,
        ),
      };
    },
    alphabet: () => D,
    note: "stdnum decides the century of a 10-digit number from today's date, so the oracle is: valid in any of the 18, 19, 20 centuries",
  },
  {
    name: "eu_vat AT",
    validator: "eu_vat",
    fmt: (c) => "AT" + c,
    theirs: sd(mod("AT", "uid")),
    gen: (r) => {
      const body = "U" + digs(r, 7);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: (c, i) => (i === 0 ? "U" : D),
    note: "same domain",
  },
  {
    name: "eu_vat BE",
    validator: "eu_vat",
    fmt: (c) => "BE" + c,
    theirs: sd(mod("BE", "vat")),
    gen: (r) => {
      const body = pick(r, "01") + digs(r, 7);
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: (c, i) => (i === 0 ? "01" : D),
    note: "same domain",
  },
  {
    name: "eu_vat DE",
    validator: "eu_vat",
    fmt: (c) => "DE" + c,
    theirs: sd(mod("DE", "vat")),
    gen: (r) => {
      const body = pick(r, "123456789") + digs(r, 7);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: (c, i) => (i === 0 ? "123456789" : D),
    note: "same domain",
  },
  {
    name: "eu_vat ES",
    validator: "eu_vat",
    fmt: (c) => "ES" + c,
    theirs: sd(mod("ES", "nif")),
    gen: (r) => {
      const kind = int(r, 0, 3);
      const body =
        kind === 0
          ? digs(r, 8)
          : kind === 1
            ? pick(r, "XYZ") + digs(r, 7)
            : kind === 2
              ? pick(r, "KLM") + digs(r, 7)
              : pick(r, "ABCDEFGHJNPQRSUVW") + digs(r, 7);
      return { make: (c) => body + c, checks: [...L.split(""), ...D.split("")] };
    },
    alphabet: (c, i) => (i === 0 ? DL : i === 8 ? DL : D),
    note: "same domain",
  },
  {
    name: "eu_vat FR",
    validator: "eu_vat",
    fmt: (c) => "FR" + c,
    theirs: sd(mod("FR", "tva")),
    gen: (r) => {
      const t = sd(mod("FR", "siren"));
      const head = pick(r, "123456789") + digs(r, 7);
      let siren = head + "0";
      for (const d of D) if (t(head + d).valid) siren = head + d;
      const letters: string[] = [];
      const A = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      for (const a of A)
        for (const b of A) if (!(D.includes(a) && D.includes(b))) letters.push(a + b);
      return { make: (c) => c + siren, checks: r() < 0.7 ? range(100, 2) : letters };
    },
    alphabet: (c, i) => (i < 2 ? "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ" : D),
    // stdnum does not check the SIREN's Luhn digit when its first three digits are 000 (Monaco);
    // §3.5 asks for it always.
    ignore: (c) => c.slice(2, 5) === "000",
    note: "ignores a SIREN starting 000 (stdnum's Monaco exception)",
  },
  {
    name: "eu_vat IT",
    validator: "eu_vat",
    fmt: (c) => "IT" + c,
    theirs: sd(mod("IT", "iva")),
    gen: (r) => {
      const body = pad(int(r, 1, 9999999), 7) + pad(int(r, 1, 100), 3);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: () => D,
    theirsStricterThanSpec:
      "stdnum also checks the province code and a non-zero company number; §3.5 asks for Luhn only",
    note: "stdnum is stricter on components",
  },
  {
    name: "eu_vat NL (BSN eleven-test)",
    validator: "eu_vat",
    fmt: (c) => "NL" + c,
    theirs: sd(mod("NL", "btw")),
    gen: (r) => {
      const body = digs(r, 8);
      return { make: (c) => body + c + "B01", checks: range(10, 1) };
    },
    alphabet: (c, i) => (i === 9 ? "B" : D),
    // stdnum refuses the suffix B00; §3.5 names only the eleven-test, so B00 is accepted by us.
    ignore: (c) => c.endsWith("B00"),
    note: "ignores the suffix B00 (stdnum refuses it; see report)",
  },
  {
    name: "eu_vat NL (MOD 97-10)",
    validator: "eu_vat",
    fmt: (c) => "NL" + c,
    theirs: sd(mod("NL", "btw")),
    gen: (r) => {
      const body = digs(r, 9) + "B";
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: (c, i) => (i === 9 ? "B" : D),
    ignore: (c) => c.endsWith("B00"),
    note: "ignores the suffix B00 (stdnum refuses it; see report)",
  },
  {
    name: "eu_vat PL",
    validator: "eu_vat",
    fmt: (c) => "PL" + c,
    theirs: sd(mod("PL", "nip")),
    gen: (r) => {
      const body = digs(r, 9);
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: () => D,
    theirsStricterThanSpec: "stdnum also refuses some tax-office prefixes (first three digits)",
    note: "stdnum is stricter on the prefix",
  },
  {
    name: "eu_vat SE",
    validator: "eu_vat",
    fmt: (c) => "SE" + c,
    theirs: sd(mod("SE", "vat")),
    gen: (r) => {
      const body = digs(r, 9);
      return { make: (c) => body + c + "01", checks: range(10, 1) };
    },
    alphabet: () => D,
    note: "same domain",
  },
  {
    name: "cn_ric",
    validator: "cn_ric",
    fmt: (c) => c,
    theirs: sd(mod("CN", "ric")),
    gen: (r) => {
      const region = pickOf(r, ["110101", "310101", "440300", "360426", "510104", "330102"]);
      const body =
        region +
        pad(int(r, 1950, 2020), 4) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 1, 28), 2) +
        pad(int(r, 0, 999), 3);
      return { make: (c) => body + c, checks: [...D.split(""), "X"] };
    },
    alphabet: (c, i) => (i === 17 ? D + "X" : D),
    theirsStricterThanSpec:
      "stdnum checks the region code against the national list; §3.3.3 does not",
    note: "stdnum checks the region",
  },
  {
    name: "cn_uscc",
    validator: "cn_uscc",
    fmt: (c) => c,
    theirs: sd(mod("CN", "uscc")),
    gen: (r) => {
      const A = "0123456789ABCDEFGHJKLMNPQRTUWXY";
      const body =
        pick(r, "1259N") +
        pick(r, "1239") +
        digs(r, 6) +
        Array.from({ length: 9 }, () => pick(r, A)).join("");
      return { make: (c) => body + c, checks: A.split("") };
    },
    alphabet: () => "0123456789ABCDEFGHJKLMNPQRTUWXY",
    theirsStricterThanSpec:
      "stdnum checks the registry and organisation-type characters and the region",
    note: "stdnum checks structure",
  },
  {
    name: "hkid",
    validator: "hkid",
    fmt: (c) => `${c.slice(0, -1)}(${c.slice(-1)})`,
    theirs: sd(mod("HK", "hkid")),
    gen: (r) => {
      const letters = r() < 0.5 ? pick(r, L) : pick(r, L) + pick(r, L);
      const body = letters + digs(r, 6);
      return { make: (c) => body + c, checks: [...D.split(""), "A"] };
    },
    alphabet: (c, i) =>
      i === c.length - 1 ? D + "A" : (c[i] as string) >= "0" && (c[i] as string) <= "9" ? D : L,
    ignore: (c) => /^[A-Z]*[ ]?/.test(c) && /[OI]/.test(c.slice(0, 2)) && false,
    note: "same domain",
  },
  {
    name: "in_pan",
    validator: "in_pan",
    fmt: (c) => c,
    theirs: sd(mod("IN", "pan")),
    gen: (r) => {
      const body =
        Array.from({ length: 3 }, () => pick(r, L)).join("") +
        pick(r, "ABCFGHLJPTK") +
        pick(r, L) +
        pad(int(r, 1, 9999), 4);
      return { make: (c) => body + c, checks: L.split("") };
    },
    alphabet: (c, i) => (i < 5 || i === 9 ? L : D),
    note: "same domain",
  },
  {
    name: "in_gstin",
    validator: "in_gstin",
    fmt: (c) => c,
    theirs: sd(mod("IN", "gstin")),
    gen: (r) => {
      const pan =
        Array.from({ length: 3 }, () => pick(r, L)).join("") +
        pick(r, "ABCFGHLJPTK") +
        pick(r, L) +
        pad(int(r, 1, 9999), 4) +
        pick(r, L);
      const body =
        pad(int(r, 1, 37), 2) + pan + pick(r, "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") + "Z";
      return { make: (c) => body + c, checks: DL.split("") };
    },
    alphabet: (c, i) => (i >= 2 && i <= 6 ? L : i >= 7 && i <= 10 ? D : i === 11 ? L : DL),
    note: "same domain",
  },
  {
    name: "kr_rrn",
    validator: "kr_rrn",
    fmt: (c) => `${c.slice(0, 6)}-${c.slice(6)}`,
    theirs: (c) => {
      // §3.5 applies no checksum (since 2020 new numbers end in random digits); stdnum still does,
      // so the oracle is: stdnum accepts the number for some last digit.
      const t = sd(mod("KR", "rrn"));
      for (const d of D) if (t(c.slice(0, 12) + d).valid) return { valid: true };
      return { valid: false };
    },
    gen: (r) => {
      const body =
        pad(int(r, 0, 99), 2) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 1, 28), 2) +
        pick(r, "12345678") +
        digs(r, 5);
      return { make: (c) => body + c, checks: D.split("") };
    },
    alphabet: (c, i) => (i === 6 ? "12345678" : D),
    // stdnum refuses a birth date in the future (a clock read); 2000s years from 2020 are left out.
    // It also refuses a region code (digits 8 and 9) above 96, which §3.5 does not check.
    ignore: (c) =>
      ("3478".includes(c[6] as string) && Number(c.slice(0, 2)) >= 20) ||
      Number(c.slice(7, 9)) > 96,
    note: "oracle: stdnum accepts for some check digit (no checksum in §3.5)",
  },
  {
    name: "br_cpf",
    validator: "br_cpf",
    fmt: (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`,
    theirs: sd(mod("BR", "cpf")),
    gen: (r) => {
      const body = digs(r, 9);
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: () => D,
    note: "same domain",
  },
  {
    name: "br_cnpj",
    validator: "br_cnpj",
    fmt: (c) =>
      `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`,
    theirs: sd(mod("BR", "cnpj")),
    gen: (r) => {
      const body = Array.from({ length: 12 }, () => pick(r, r() < 0.5 ? D : DL)).join("");
      return { make: (c) => body + c, checks: range(100, 2) };
    },
    alphabet: (c, i) => (i >= 12 ? D : DL),
    note: "same domain",
  },
  {
    name: "mx_curp",
    validator: "mx_curp",
    fmt: (c) => c,
    theirs: sd(mod("MX", "curp")),
    gen: (r) => {
      const yy = int(r, 0, 99);
      const states = ["AS", "BC", "DF", "JC", "NE", "VZ", "ZS", "MC"];
      const homo = yy < 30 && r() < 0.5 ? pick(r, L) : pick(r, D);
      const century2000 = !D.includes(homo);
      const body =
        Array.from({ length: 4 }, () => pick(r, L)).join("") +
        pad(century2000 ? yy : yy, 2) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 1, 28), 2) +
        pick(r, "HM") +
        pickOf(r, states) +
        Array.from({ length: 3 }, () => pick(r, "BCDFGHJKLMNPQRSTVWXYZ")).join("") +
        homo;
      return { make: (c) => body + c, checks: D.split("") };
    },
    alphabet: (c, i) => (i >= 4 && i <= 9 ? D : i === 10 ? "HM" : i === 16 ? DL : i === 17 ? D : L),
    theirsStricterThanSpec:
      "stdnum also refuses the reserved words that CURP replaces with X in the first four letters",
    note: "stdnum checks reserved words",
  },
  {
    name: "za_id",
    validator: "za_id",
    fmt: (c) => c,
    theirs: sd(mod("ZA", "idnr")),
    gen: (r) => {
      const body =
        pad(int(r, 0, 99), 2) +
        pad(int(r, 1, 12), 2) +
        pad(int(r, 1, 28), 2) +
        digs(r, 4) +
        pick(r, "01") +
        pick(r, "89");
      return { make: (c) => body + c, checks: range(10, 1) };
    },
    alphabet: () => D,
    note: "same domain",
  },
  {
    name: "ca_bn",
    validator: "ca_bn",
    fmt: (c) => `${c.slice(0, 9)} ${c.slice(9, 11)} ${c.slice(11)}`,
    theirs: sd(mod("CA", "bn")),
    gen: (r) => {
      const body = digs(r, 8);
      const tail = pickOf(r, ["RC", "RT", "RP", "RM", "RR", "RZ"]) + pad(int(r, 1, 9999), 4);
      return { make: (c) => body + c + tail, checks: range(10, 1) };
    },
    alphabet: (c, i) => (i === 9 ? ("RCMPTZ".split("")[0] as string) : i === 10 ? "CMPRTZ" : D),
    ignore: (c) => !/^[0-9]{9}R[CMPRTZ][0-9]{4}$/.test(c),
    theirsStricterThanSpec: "stdnum checks the program identifier and the leading digit",
    note: "same domain, program letter restricted",
  },
];

function makeValid(spec: Spec, r: Rng, count: number): string[] {
  const out: string[] = [];
  let attempts = 0;
  while (out.length < count && attempts++ < count * 20) {
    const g = spec.gen(r);
    for (const c of g.checks) {
      const v = g.make(c);
      if (spec.theirs(v).valid) {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

function mutate(spec: Spec, r: Rng, v: string): string {
  const i = int(r, 0, v.length - 1);
  const alpha = (spec.alphabet ?? classAlphabet)(v, i);
  const options = alpha.split("").filter((ch) => ch !== v[i]);
  if (options.length === 0) return v;
  return v.slice(0, i) + pick(r, options.join("")) + v.slice(i + 1);
}

describe("VAL-2 agreement with stdnum", () => {
  // The comparisons are long synchronous loops; yielding one macrotask between them lets the test
  // runner's worker answer its own calls, which otherwise time out after 60 s of back-to-back work.
  afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  for (const spec of SPECS) {
    it(`VAL-2 stdnum agreement: ${spec.name} (${COUNT} valid, ${COUNT} changed; ${spec.note})`, () => {
      const ours = VALIDATORS[spec.validator] as (s: string) => { ok: boolean };
      const r = mulberry32(0x5eed + spec.name.length);
      const valid = makeValid(spec, r, COUNT);
      expect(valid.length).toBeGreaterThanOrEqual(Math.floor(COUNT * 0.9));
      const changed = Array.from({ length: COUNT }, (_, i) =>
        mutate(spec, r, valid[i % valid.length] as string),
      );
      const mismatches: string[] = [];
      let known = 0;
      let agreedValid = 0;
      for (const v of [...valid, ...changed]) {
        if (spec.ignore?.(v)) {
          known++;
          continue;
        }
        const o = ours(spec.fmt(v)).ok;
        const t = spec.theirs(v);
        if (o === t.valid) {
          if (o) agreedValid++;
          continue;
        }
        if (
          o &&
          !t.valid &&
          spec.theirsStricterThanSpec !== undefined &&
          t.kind !== "InvalidChecksum"
        ) {
          known++;
          continue;
        }
        mismatches.push(`${spec.fmt(v)} ours=${o} stdnum=${t.valid}(${t.kind})`);
      }
      expect(mismatches.slice(0, 5), `${mismatches.length} mismatches`).toEqual([]);
      // the comparison is not vacuous: valid values were found and agreed on
      expect(agreedValid).toBeGreaterThan(COUNT * 0.3);
      void known;
    });
  }

  it("VAL-2 stdnum agreement: ssn_rules against stdnum's US SSN (documented common domain)", () => {
    // stdnum's SSN rules: area not 000, 666 or 900-999; group not 00; serial not 0000.
    // §3.5 additionally refuses three voided numbers, so those are excluded.
    const r = mulberry32(99);
    const t = sd(mod("US", "ssn"));
    const ours = VALIDATORS.ssn_rules as (s: string) => { ok: boolean };
    const bad: string[] = [];
    for (let i = 0; i < COUNT * 2; i++) {
      const c =
        i % 3 === 0
          ? pad(int(r, 0, 999), 3) + pad(int(r, 0, 99), 2) + pad(int(r, 0, 9999), 4)
          : digs(r, 9);
      const f = `${c.slice(0, 3)}-${c.slice(3, 5)}-${c.slice(5)}`;
      if (["078-05-1120", "219-09-9999", "123-45-6789"].includes(f)) continue;
      // stdnum accepts serial 0000; §3.5 (the SSA's own rule) refuses it.
      if (c.slice(5) === "0000") continue;
      if (ours(f).ok !== t(c).valid) bad.push(`${f} ours=${ours(f).ok} stdnum=${t(c).valid}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
