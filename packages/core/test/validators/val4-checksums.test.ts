// VAL-4: checksums decide. Generated valid card numbers, IBANs and crypto addresses are accepted
// by the validators their rules name; each with one character changed is rejected. Generators use
// a fixed seed and compute the check themselves, so they share no code with the validators.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VALIDATORS } from "../../src/validators";
import { runValidators } from "./fixtures";

const COUNT = ["local", "full"].includes(process.env.DISTILLER_TIER ?? "") ? 5_000 : 300;

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
const bytes = (r: Rng, n: number): number[] => Array.from({ length: n }, () => int(r, 0, 255));

function changeOne(
  r: Rng,
  value: string,
  positions: number[],
  alphabet: (ch: string) => string,
): string {
  const i = positions[int(r, 0, positions.length - 1)] as number;
  const options = alphabet(value[i] as string)
    .split("")
    .filter((c) => c !== value[i]);
  return value.slice(0, i) + pick(r, options.join("")) + value.slice(i + 1);
}

describe("VAL-4 checksums decide: payment cards", () => {
  const networks: { prefix: () => string; lengths: number[] }[] = [
    { prefix: () => "4", lengths: [13, 16, 19] },
    { prefix: () => String(int(mulberry32(1), 51, 55)), lengths: [16] },
    { prefix: () => "34", lengths: [15] },
    { prefix: () => "37", lengths: [15] },
    { prefix: () => "6011", lengths: [16, 19] },
    { prefix: () => "65", lengths: [16] },
    { prefix: () => "3528", lengths: [16, 19] },
    { prefix: () => "36", lengths: [14, 16] },
    { prefix: () => "300", lengths: [14] },
  ];
  function card(r: Rng): string {
    const n = networks[int(r, 0, networks.length - 1)] as (typeof networks)[number];
    const len = n.lengths[int(r, 0, n.lengths.length - 1)] as number;
    let body = n.prefix();
    while (body.length < len - 1) body += pick(r, "0123456789");
    let sum = 0;
    for (let i = 0; i < body.length; i++) {
      let d = Number(body[body.length - 1 - i]);
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return body + String((10 - (sum % 10)) % 10);
  }
  const names = ["separators_consistent", "luhn", "card_iin"];
  it("VAL-4 generated valid card numbers hit; one changed digit does not", () => {
    const r = mulberry32(4);
    for (let i = 0; i < COUNT; i++) {
      const c = card(r);
      const printed = i % 2 === 0 ? c : c.replace(/(.{4})(?=.)/g, "$1 ");
      expect(runValidators(names, printed), printed).toBe(true);
      const positions = [...printed]
        .map((ch, k) => (ch >= "0" && ch <= "9" ? k : -1))
        .filter((k) => k >= 0);
      const bad = changeOne(r, printed, positions, () => "0123456789");
      expect(runValidators(names, bad), bad).toBe(false);
    }
  });
});

describe("VAL-4 checksums decide: IBANs", () => {
  const lengths: Record<string, number> = {
    GB: 22,
    DE: 22,
    FR: 27,
    ES: 24,
    IT: 27,
    NL: 18,
    BE: 16,
    CH: 21,
    AT: 20,
    PL: 28,
    SE: 24,
    NO: 15,
    DK: 18,
    IE: 22,
    PT: 25,
    FI: 18,
    LU: 20,
  };
  const mod97 = (s: string): number => {
    let r = 0;
    for (const ch of s) {
      const v = ch >= "0" && ch <= "9" ? Number(ch) : ch.charCodeAt(0) - 55;
      r = Number(String(r) + String(v)) % 97;
    }
    return r;
  };
  function iban(r: Rng): string {
    const cc = pick(r, Object.keys(lengths).join("")); // placeholder replaced below
    void cc;
    const codes = Object.keys(lengths);
    const country = codes[int(r, 0, codes.length - 1)] as string;
    const bban = Array.from({ length: (lengths[country] as number) - 4 }, () =>
      pick(r, r() < 0.7 ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
    ).join("");
    const check = String(98 - mod97(bban + country + "00")).padStart(2, "0");
    return country + check + bban;
  }
  it("VAL-4 generated valid IBANs hit; one changed character does not", () => {
    const r = mulberry32(5);
    for (let i = 0; i < COUNT; i++) {
      const v = iban(r);
      const printed = i % 2 === 0 ? v : v.replace(/(.{4})(?=.)/g, "$1 ");
      expect(runValidators(["iban_mod97"], printed), printed).toBe(true);
      const positions = [...printed].map((ch, k) => (ch === " " ? -1 : k)).filter((k) => k >= 0);
      // same class (digit for digit, letter for letter): a different class can change the length
      const bad = changeOne(r, printed, positions, (ch) =>
        ch >= "0" && ch <= "9" ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      );
      expect(runValidators(["iban_mod97"], bad), bad).toBe(false);
    }
  });
});

describe("VAL-4 checksums decide: crypto addresses", () => {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const sha = (b: number[]): Buffer => createHash("sha256").update(Buffer.from(b)).digest();
  function base58(all: number[]): string {
    let n = 0n;
    for (const b of all) n = n * 256n + BigInt(b);
    let out = "";
    while (n > 0n) {
      out = B58[Number(n % 58n)] + out;
      n /= 58n;
    }
    for (const b of all) {
      if (b !== 0) break;
      out = "1" + out;
    }
    return out;
  }
  const versions: [number, string][] = [
    [0x00, "btc"],
    [0x05, "btc"],
    [0x30, "ltc"],
    [0x32, "ltc"],
    [0x1e, "doge"],
    [0x16, "doge"],
  ];
  it("VAL-4 generated base58check addresses hit with their variant; one changed character does not", () => {
    const r = mulberry32(6);
    for (let i = 0; i < COUNT; i++) {
      const [ver, variant] = versions[int(r, 0, versions.length - 1)] as [number, string];
      const payload = [ver, ...bytes(r, 20)];
      const addr = base58([...payload, ...sha([...sha(payload)]).subarray(0, 4)]);
      const res = (VALIDATORS.base58check as (s: string) => { ok: boolean; variant?: string })(
        addr,
      );
      expect(res.ok, addr).toBe(true);
      expect(res.variant).toBe(variant);
      const bad = changeOne(
        r,
        addr,
        [...addr].map((_, k) => k),
        () => B58,
      );
      expect(runValidators(["base58check"], bad), bad).toBe(false);
    }
  });
  it("VAL-4 a version byte outside the list is refused even with a correct checksum", () => {
    const r = mulberry32(61);
    for (const ver of [0x01, 0x04, 0x6f, 0x80, 0xff]) {
      const payload = [ver, ...bytes(r, 20)];
      expect(
        runValidators(
          ["base58check"],
          base58([...payload, ...sha([...sha(payload)]).subarray(0, 4)]),
        ),
      ).toBe(false);
    }
  });

  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(values: number[]): number {
    const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= gen[i] as number;
    }
    return chk >>> 0;
  }
  function convert(data: number[]): number[] {
    let acc = 0,
      bits = 0;
    const out: number[] = [];
    for (const v of data) {
      acc = (acc << 8) | v;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out.push((acc >> bits) & 31);
      }
      acc &= (1 << bits) - 1;
    }
    if (bits > 0) out.push((acc << (5 - bits)) & 31);
    return out;
  }
  function segwit(hrp: string, version: number, program: number[]): string {
    const data = [version, ...convert(program)];
    const exp = [
      ...[...hrp].map((c) => c.charCodeAt(0) >> 5),
      0,
      ...[...hrp].map((c) => c.charCodeAt(0) & 31),
    ];
    const mod = polymod([...exp, ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? 1 : 0x2bc830a3);
    const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
    return hrp + "1" + [...data, ...checksum].map((d) => CHARSET[d]).join("");
  }
  it("VAL-4 generated bech32 and bech32m addresses (v0 and v1, bc and ltc) hit; one changed character does not", () => {
    const r = mulberry32(7);
    for (let i = 0; i < COUNT; i++) {
      const hrp = r() < 0.5 ? "bc" : "ltc";
      const version = r() < 0.5 ? 0 : 1;
      const program = bytes(r, version === 0 ? (r() < 0.5 ? 20 : 32) : 32);
      const addr = segwit(hrp, version, program);
      const res = (VALIDATORS.bech32 as (s: string) => { ok: boolean; variant?: string })(addr);
      expect(res.ok, addr).toBe(true);
      expect(res.variant).toBe(hrp === "bc" ? "btc" : "ltc");
      const start = hrp.length + 1;
      const bad = changeOne(
        r,
        addr,
        [...addr].map((_, k) => k).filter((k) => k >= start),
        () => CHARSET,
      );
      expect(runValidators(["bech32"], bad), bad).toBe(false);
    }
  });
  it("VAL-4 a Bech32 checksum on a version 1 address (or Bech32m on version 0) is refused", () => {
    const r = mulberry32(71);
    const program = bytes(r, 32);
    const data1 = [1, ...convert(program)];
    const exp = [3, 3, 0, 2, 3];
    const mod = polymod([...exp, ...data1, 0, 0, 0, 0, 0, 0]) ^ 1; // wrong constant for version 1
    const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
    const wrong = "bc1" + [...data1, ...checksum].map((d) => CHARSET[d]).join("");
    expect(runValidators(["bech32"], wrong)).toBe(false);
  });
});
