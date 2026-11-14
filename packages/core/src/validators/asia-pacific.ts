// Provides the Asia-Pacific validators of §3.5: cn_ric, cn_uscc, hkid, in_pan, in_gstin, kr_rrn
// and sg_nric. Where the check algorithm is not published by the issuer (hkid, sg_nric), the one
// every open-source validator uses is implemented, as §3.3.3 says.
import { ACCEPT, REJECT } from "./types";
import type { Validator } from "./types";
import { digitsOf, isRealDate, stripChars } from "./util";

/** China resident identity number: a real birth date and the ISO 7064 MOD 11-2 check. */
export const cn_ric: Validator = (matched) => {
  const m = /^([0-9]{6})([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{3})([0-9X])$/.exec(matched);
  if (m === null) return REJECT;
  if (!isRealDate(Number(m[2]), Number(m[3]), Number(m[4]))) return REJECT;
  let n = 0n;
  for (let i = 0; i < 17; i++) n = n * 13n + BigInt(matched.charCodeAt(i) - 48);
  const r = Number((((1n - 2n * n) % 11n) + 11n) % 11n);
  return (r === 10 ? "X" : String(r)) === m[6] ? ACCEPT : REJECT;
};

const USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

/** China unified social credit code: weighted sum over the 31-letter alphabet. */
export const cn_uscc: Validator = (matched) => {
  if (matched.length !== 18) return REJECT;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const idx = USCC_ALPHABET.indexOf(matched[i] as string);
    if (idx < 0) return REJECT;
    sum += idx * (USCC_WEIGHTS[i] as number);
  }
  const check = USCC_ALPHABET[(31 - (sum % 31)) % 31];
  return check === matched[17] ? ACCEPT : REJECT;
};

function letterValue(ch: string): number {
  return ch.charCodeAt(0) - 55;
}

/**
 * Hong Kong identity card number with its parenthesised check digit. A single letter counts as
 * if preceded by a space (value 36); weights 9 to 2; check = (11 - sum mod 11) mod 11, 10 as `A`.
 */
export const hkid: Validator = (matched) => {
  const m = /^([A-NP-Z]{1,2})([0-9]{6})\(([0-9A])\)$/.exec(matched);
  if (m === null) return REJECT;
  const letters = m[1] as string;
  const values = [
    letters.length === 1 ? 36 : letterValue(letters[0] as string),
    letterValue(letters[letters.length - 1] as string),
    ...(m[2] as string).split("").map((c) => c.charCodeAt(0) - 48),
  ];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (values[i] as number) * (9 - i);
  const check = (11 - (sum % 11)) % 11;
  return (check === 10 ? "A" : String(check)) === m[3] ? ACCEPT : REJECT;
};

const PAN_HOLDER_TYPES = "ABCFGHLJPTK";

/**
 * India PAN: serial (characters 6 to 9) not 0000. The fourth character must be a holder-type
 * letter, which the rule's pattern also enforces; it is repeated so the bare validator is right.
 */
export const in_pan: Validator = (matched) => {
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(matched)) return REJECT;
  if (!PAN_HOLDER_TYPES.includes(matched[3] as string)) return REJECT;
  return matched.slice(5, 9) === "0000" ? REJECT : ACCEPT;
};

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** India GSTIN: state code 01 to 37, characters 3 to 12 a PAN, Luhn mod 36 over all 15. */
export const in_gstin: Validator = (matched) => {
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(matched)) return REJECT;
  const state = Number(matched.slice(0, 2));
  if (state < 1 || state > 37) return REJECT;
  if (!in_pan(matched.slice(2, 12)).ok) return REJECT;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const v = GSTIN_ALPHABET.indexOf(matched[14 - i] as string);
    if (i % 2 === 0) sum += v;
    else {
      const w = v * 2;
      sum += Math.floor(w / 36) + (w % 36);
    }
  }
  return sum % 36 === 0 ? ACCEPT : REJECT;
};

/**
 * Korea resident registration number: a real date with the century from the seventh digit (1, 2,
 * 5, 6 the 1900s; 3, 4, 7, 8 the 2000s). No checksum: since 2020 new numbers end in random digits.
 * For a citizen (seventh digit 1 to 4) born before 2020 the region code, digits 8 and 9, is at most
 * 96. Numbers of foreign residents (5 to 8) and births from 2020 have no region check.
 */
export const kr_rrn: Validator = (matched) => {
  const d = digitsOf(stripChars(matched, "-"));
  if (d.length !== 13) return REJECT;
  const g = d[6] as string;
  let century: number;
  if ("1256".includes(g)) century = 1900;
  else if ("3478".includes(g)) century = 2000;
  else return REJECT;
  const year = century + Number(d.slice(0, 2));
  if (!isRealDate(year, Number(d.slice(2, 4)), Number(d.slice(4, 6)))) return REJECT;
  if ("1234".includes(g) && year < 2020 && Number(d.slice(7, 9)) > 96) return REJECT;
  return ACCEPT;
};

const NRIC_TABLES: Readonly<Record<string, string>> = Object.freeze({
  S: "JZIHGFEDCBA",
  T: "JZIHGFEDCBA",
  F: "XWUTRQPNMLK",
  G: "XWUTRQPNMLK",
  M: "XWUTRQPNJLK",
});
const NRIC_OFFSET: Readonly<Record<string, number>> = Object.freeze({
  S: 0,
  T: 4,
  F: 0,
  G: 4,
  M: 3,
});

/** Singapore NRIC or FIN: digits weighted 2, 7, 6, 5, 4, 3, 2, an offset by series, a letter table. */
export const sg_nric: Validator = (matched) => {
  const m = /^([STFGM])([0-9]{7})([A-Z])$/.exec(matched);
  if (m === null) return REJECT;
  const series = m[1] as string;
  const w = [2, 7, 6, 5, 4, 3, 2];
  let sum = NRIC_OFFSET[series] as number;
  for (let i = 0; i < 7; i++) sum += Number((m[2] as string)[i]) * (w[i] as number);
  return (NRIC_TABLES[series] as string)[sum % 11] === m[3] ? ACCEPT : REJECT;
};
