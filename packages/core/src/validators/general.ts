// Provides the general validators of §3.5: separators_consistent, has_letter, luhn, ean13,
// iban_mod97, card_iin, base58check, bech32, the three MRZ layouts and vin_na. Each takes the
// matched text and answers accept or reject; none reads the clock.
import { createHash } from "node:crypto";
import { ACCEPT, REJECT, accept } from "./types";
import type { Validator } from "./types";
import { digitsOf, isAsciiAlnum, isAsciiDigit, luhnValid, stripChars } from "./util";

/**
 * Every separator in the match is the same character. A separator is a run of characters that is
 * not a letter or digit, between two letters or digits. For a North American phone number the
 * separators that count are the two after the area code: the run holding a parenthesis, and the
 * one after a leading country code `1`, are not compared.
 */
export const separators_consistent: Validator = (matched) => {
  const runs: string[] = [];
  let cur = "";
  let seenAlnum = false;
  for (const ch of matched) {
    if (isAsciiAlnum(ch)) {
      if (cur !== "") runs.push(cur);
      cur = "";
      seenAlnum = true;
    } else if (seenAlnum) {
      cur += ch;
    }
  }
  const hasParen = matched.includes("(") || matched.includes(")");
  let counted = runs.filter((r) => !r.includes("(") && !r.includes(")"));
  if (!hasParen && digitsOf(matched).length === 11 && runs.length > 0) {
    // A country code `1` then its separator (a phone number); that separator is not compared.
    counted = counted.slice(1);
  }
  return counted.every((r) => r === counted[0]) ? ACCEPT : REJECT;
};

/** The match contains at least one letter. */
export const has_letter: Validator = (matched) => (/\p{L}/u.test(matched) ? ACCEPT : REJECT);

/** Luhn mod 10 over the digits of the match (ISO/IEC 7812-1). */
export const luhn: Validator = (matched) => (luhnValid(digitsOf(matched)) ? ACCEPT : REJECT);

/** GS1 EAN-13 check digit over 13 digits. */
export const ean13: Validator = (matched) => {
  const d = digitsOf(matched);
  if (d.length !== 13) return REJECT;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (d.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === d.charCodeAt(12) - 48 ? ACCEPT : REJECT;
};

const IBAN_LENGTHS: Readonly<Record<string, number>> = Object.freeze({
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
});

/** The country's IBAN length, then ISO/IEC 7064 MOD 97-10: the rearranged number mod 97 is 1. */
export const iban_mod97: Validator = (matched) => {
  const s = stripChars(matched, " ");
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return REJECT;
  if (IBAN_LENGTHS[s.slice(0, 2)] !== s.length) return REJECT;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let r = 0;
  for (const ch of rearranged) {
    const v = isAsciiDigit(ch) ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
    r = v > 9 ? (r * 100 + v) % 97 : (r * 10 + v) % 97;
  }
  return r === 1 ? ACCEPT : REJECT;
};

function inRange(n: number, lo: number, hi: number): boolean {
  return n >= lo && n <= hi;
}

/** Card network prefix and length (ISO/IEC 7812), taken from the digits of the match. */
export const card_iin: Validator = (matched) => {
  const d = digitsOf(matched);
  const len = d.length;
  const p = (n: number): number => Number(d.slice(0, n));
  if (len < 13 || len > 19) return REJECT;
  const ok =
    // Visa
    (d[0] === "4" && (len === 13 || len === 16 || len === 19)) ||
    // Mastercard
    (len === 16 && (inRange(p(2), 51, 55) || inRange(p(4), 2221, 2720))) ||
    // American Express
    (len === 15 && (p(2) === 34 || p(2) === 37)) ||
    // Discover
    (len >= 16 &&
      (p(4) === 6011 || inRange(p(3), 644, 649) || p(2) === 65 || inRange(p(6), 622126, 622925))) ||
    // JCB
    (len >= 16 && inRange(p(4), 3528, 3589)) ||
    // Diners Club
    (len >= 14 && (inRange(p(3), 300, 305) || p(2) === 36 || inRange(p(2), 38, 39)));
  return ok ? ACCEPT : REJECT;
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_VARIANTS: Readonly<Record<number, string>> = Object.freeze({
  0x00: "btc",
  0x05: "btc",
  0x30: "ltc",
  0x32: "ltc",
  0x1e: "doge",
  0x16: "doge",
});

/**
 * Base58Check: 25 bytes, the last four equal to the first four of the double SHA-256 of the first
 * 21, and a version byte of Bitcoin, Litecoin or Dogecoin. Sets the variant btc, ltc or doge. It
 * judges only the Base58 shape; a Bech32 string is rejected here.
 */
export const base58check: Validator = (matched) => {
  // An address has at most 35 characters; the cap keeps the BigInt arithmetic cheap on any input.
  if (matched.length === 0 || matched.length > 64) return REJECT;
  let n = 0n;
  let leadingOnes = 0;
  let counting = true;
  for (const ch of matched) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return REJECT;
    if (counting && ch === "1") leadingOnes++;
    else counting = false;
    n = n * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  const all = [...new Array<number>(leadingOnes).fill(0), ...bytes];
  if (all.length !== 25) return REJECT;
  const payload = Buffer.from(all.slice(0, 21));
  const first = createHash("sha256").update(payload).digest();
  const second = createHash("sha256").update(first).digest();
  for (let i = 0; i < 4; i++) if (second[i] !== all[21 + i]) return REJECT;
  const variant = B58_VARIANTS[all[0] as number];
  return variant === undefined ? REJECT : accept(variant);
};

const BECH_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bechPolymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i] as number;
  }
  return chk >>> 0;
}

/**
 * Bech32 and Bech32m segwit addresses: the human-readable part `bc` or `ltc`, witness version 0
 * with the BIP 173 checksum constant 1, versions 1 to 16 with the BIP 350 constant 0x2bc830a3.
 * Sets the variant btc or ltc. Only the checksum and the version are judged.
 */
export const bech32: Validator = (matched) => {
  if (matched.length < 8 || matched.length > 90) return REJECT;
  if (matched !== matched.toLowerCase() && matched !== matched.toUpperCase()) return REJECT;
  const s = matched.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1) return REJECT;
  const hrp = s.slice(0, sep);
  if (hrp !== "bc" && hrp !== "ltc") return REJECT;
  const data: number[] = [];
  for (const ch of s.slice(sep + 1)) {
    const idx = BECH_CHARSET.indexOf(ch);
    if (idx < 0) return REJECT;
    data.push(idx);
  }
  if (data.length < 7) return REJECT;
  const version = data[0] as number;
  if (version > 16) return REJECT;
  const expand: number[] = [];
  for (const ch of hrp) expand.push(ch.charCodeAt(0) >> 5);
  expand.push(0);
  for (const ch of hrp) expand.push(ch.charCodeAt(0) & 31);
  const want = version === 0 ? 1 : 0x2bc830a3;
  return bechPolymod([...expand, ...data]) === want ? accept(hrp === "bc" ? "btc" : "ltc") : REJECT;
};

// ICAO Doc 9303 machine-readable zones. Weights 7, 3, 1 repeated; `<` is 0; A to Z are 10 to 35.
function mrzValue(ch: string): number {
  if (ch === "<") return 0;
  if (isAsciiDigit(ch)) return ch.charCodeAt(0) - 48;
  const c = ch.charCodeAt(0);
  return c >= 65 && c <= 90 ? c - 55 : -1;
}

function mrzCheck(field: string, check: string): boolean {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = mrzValue(field[i] as string);
    if (v < 0) return false;
    sum += v * (w[i % 3] as number);
  }
  return isAsciiDigit(check) && sum % 10 === check.charCodeAt(0) - 48;
}

function mrzLines(matched: string, count: number, length: number): string[] | null {
  const lines = matched.split(/\r?\n/);
  if (lines.length !== count) return null;
  return lines.every((l) => l.length === length) ? lines : null;
}

/** TD3 (passports): document number, birth date, expiry date, personal number and composite. */
export const mrz_td3: Validator = (matched) => {
  const lines = mrzLines(matched, 2, 44);
  if (lines === null) return REJECT;
  const l2 = lines[1] as string;
  if (!mrzCheck(l2.slice(0, 9), l2[9] as string)) return REJECT;
  if (!mrzCheck(l2.slice(13, 19), l2[19] as string)) return REJECT;
  if (!mrzCheck(l2.slice(21, 27), l2[27] as string)) return REJECT;
  const personal = l2.slice(28, 42);
  // An empty personal number may carry a filler `<` in place of its check digit.
  if (l2[42] === "<") {
    if (!/^<+$/.test(personal)) return REJECT;
  } else if (!mrzCheck(personal, l2[42] as string)) return REJECT;
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  return mrzCheck(composite, l2[43] as string) ? ACCEPT : REJECT;
};

/** TD2 (two lines of 36): document number, birth date, expiry date and composite. */
export const mrz_td2: Validator = (matched) => {
  const lines = mrzLines(matched, 2, 36);
  if (lines === null) return REJECT;
  const l2 = lines[1] as string;
  if (!mrzCheck(l2.slice(0, 9), l2[9] as string)) return REJECT;
  if (!mrzCheck(l2.slice(13, 19), l2[19] as string)) return REJECT;
  if (!mrzCheck(l2.slice(21, 27), l2[27] as string)) return REJECT;
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 35);
  return mrzCheck(composite, l2[35] as string) ? ACCEPT : REJECT;
};

/**
 * TD1 (identity cards, three lines of 30): document number, birth date, expiry date and the
 * composite digit (§3.3.5). A document number longer than nine characters carries `<` in place of
 * its check digit; that field cannot be checked and is accepted.
 */
export const mrz_td1: Validator = (matched) => {
  const lines = mrzLines(matched, 3, 30);
  if (lines === null) return REJECT;
  const l1 = lines[0] as string;
  const l2 = lines[1] as string;
  if (l1[14] !== "<" && !mrzCheck(l1.slice(5, 14), l1[14] as string)) return REJECT;
  if (!mrzCheck(l2.slice(0, 6), l2[6] as string)) return REJECT;
  if (!mrzCheck(l2.slice(8, 14), l2[14] as string)) return REJECT;
  // Composite: line 1 positions 6-30, then line 2 positions 1-7, 9-15 and 19-29.
  const composite = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);
  return mrzCheck(composite, l2[29] as string) ? ACCEPT : REJECT;
};

const VIN_TRANSLIT: Readonly<Record<string, number>> = Object.freeze({
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
});
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** North American VIN check digit (49 CFR 565), position 10 not U, Z or 0, a letter and a digit. */
export const vin_na: Validator = (matched) => {
  if (matched.length !== 17) return REJECT;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = matched[i] as string;
    const v = isAsciiDigit(ch) ? ch.charCodeAt(0) - 48 : VIN_TRANSLIT[ch];
    if (v === undefined) return REJECT;
    sum += v * (VIN_WEIGHTS[i] as number);
  }
  const r = sum % 11;
  if ((matched[8] as string) !== (r === 10 ? "X" : String(r))) return REJECT;
  const tenth = matched[9] as string;
  if (tenth === "U" || tenth === "Z" || tenth === "0") return REJECT;
  return /[A-Z]/.test(matched) && /[0-9]/.test(matched) ? ACCEPT : REJECT;
};
