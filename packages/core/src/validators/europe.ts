// Provides the European validators of §3.5: be_nn, cz_rc, es_dni, es_nie, fi_hetu, fr_nir,
// nino_prefix, gb_dl_surname, ie_pps, it_cf, no_fnr, se_pnr and eu_vat (one validator that
// dispatches on the country prefix). Where an identifier encodes a two-digit year, every century
// the issuer could mean is tried; no validator reads the date of the run (§2.4.5).
import { ACCEPT, REJECT, accept } from "./types";
import type { Validator, ValidatorResult } from "./types";
import {
  allDigits,
  digitsOf,
  isRealDate,
  isRealInAnyCentury,
  luhnCheckDigit,
  luhnValid,
  modDigits,
  stripChars,
  weightedSum,
} from "./util";

/**
 * Belgian national number: raw month 00 to 12; the date real when month and day are not 0; the
 * check 97 - (first nine digits mod 97), or the same with a 2 prefixed (born from 2000).
 */
export const be_nn: Validator = (matched) => {
  const d = digitsOf(matched);
  if (d.length !== 11) return REJECT;
  const yy = Number(d.slice(0, 2));
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  if (mm > 12) return REJECT;
  const n9 = Number(d.slice(0, 9));
  const last = Number(d.slice(9));
  const dateOk = (century: number): boolean =>
    mm === 0 || dd === 0 || isRealDate(century + yy, mm, dd);
  if (97 - (n9 % 97) === last && dateOk(1900)) return ACCEPT;
  if (97 - ((2_000_000_000 + n9) % 97) === last && dateOk(2000)) return ACCEPT;
  return REJECT;
};

/**
 * Czech and Slovak birth number with ten digits: month MM mod 50 mod 20, year 1954 to 2053 from
 * YY, a real date, and the first nine digits mod 11 mod 10 equal to the last digit.
 */
export const cz_rc: Validator = (matched) => {
  const d = digitsOf(matched);
  if (d.length !== 10) return REJECT;
  const yy = Number(d.slice(0, 2));
  const mon = (Number(d.slice(2, 4)) % 50) % 20;
  const dd = Number(d.slice(4, 6));
  const year = yy >= 54 ? 1900 + yy : 2000 + yy;
  if (!isRealDate(year, mon, dd)) return REJECT;
  return modDigits(d.slice(0, 9), 11) % 10 === Number(d[9]) ? ACCEPT : REJECT;
};

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Spanish DNI: the letter is DNI_LETTERS[number mod 23]. */
export const es_dni: Validator = (matched) => {
  const m = /^([0-9]{8})-?([A-Z])$/.exec(matched);
  if (m === null) return REJECT;
  return DNI_LETTERS[Number(m[1]) % 23] === m[2] ? ACCEPT : REJECT;
};

/** Spanish NIE: X, Y, Z read as 0, 1, 2 before the seven digits, then the DNI letter rule. */
export const es_nie: Validator = (matched) => {
  const m = /^([XYZ])-?([0-9]{7})-?([A-Z])$/.exec(matched);
  if (m === null) return REJECT;
  const n = Number("XYZ".indexOf(m[1] as string).toString() + (m[2] as string));
  return DNI_LETTERS[n % 23] === m[3] ? ACCEPT : REJECT;
};

const HETU_CHECK = "0123456789ABCDEFHJKLMNPRSTUVWXY";

/** Finnish personal identity code: century from the sign, a real date, individual number >= 002. */
export const fi_hetu: Validator = (matched) => {
  const m = /^([0-3][0-9])([01][0-9])([0-9]{2})([-+A-FU-Y])([0-9]{3})([0-9A-FHJ-NPR-Y])$/.exec(
    matched,
  );
  if (m === null) return REJECT;
  const sign = m[4] as string;
  const century = sign === "+" ? 1800 : sign >= "A" && sign <= "F" ? 2000 : 1900;
  if (!isRealDate(century + Number(m[3]), Number(m[2]), Number(m[1]))) return REJECT;
  const person = Number(m[5]);
  if (person < 2) return REJECT;
  const n = Number((m[1] as string) + (m[2] as string) + (m[3] as string) + (m[5] as string));
  if (HETU_CHECK[n % 31] !== m[6]) return REJECT;
  return person >= 900 ? accept("temporary") : ACCEPT;
};

/** French NIR: 2A is read as 19 and 2B as 18; key = 97 - (first 13 digits mod 97). */
export const fr_nir: Validator = (matched) => {
  const s = stripChars(matched, " ");
  const m = /^([12][0-9]{4})([0-9]{2}|2A|2B)([0-9]{6})([0-9]{2})$/.exec(s);
  if (m === null) return REJECT;
  const dept = m[2] === "2A" ? "19" : m[2] === "2B" ? "18" : (m[2] as string);
  const n = (m[1] as string) + dept + (m[3] as string);
  return 97 - modDigits(n, 97) === Number(m[4]) ? ACCEPT : REJECT;
};

const NINO_BAD_PREFIXES = ["BG", "GB", "KN", "NK", "NT", "TN", "ZZ", "FY", "NC"];

/**
 * UK National Insurance number prefix: not one of BG, GB, KN, NK, NT, TN, ZZ, FY or NC. As well, a
 * first letter of D, F, I, Q, U or V and a second letter of D, F, I, O, Q, U or V are refused,
 * which is what the rule's pattern allows only; this keeps the answer right on the bare validator.
 */
export const nino_prefix: Validator = (matched) => {
  const p = stripChars(matched, " ").slice(0, 2);
  if (!/^[A-Z]{2}$/.test(p)) return REJECT;
  if ("DFIQUV".includes(p[0] as string) || "DFIOQUV".includes(p[1] as string)) return REJECT;
  return NINO_BAD_PREFIXES.includes(p) ? REJECT : ACCEPT;
};

/** UK driving licence: the first five characters are letters then only 9s, and not 99999. */
export const gb_dl_surname: Validator = (matched) => {
  const first = matched.slice(0, 5);
  return /^[A-Z]*9*$/.test(first) && first.length === 5 && first !== "99999" ? ACCEPT : REJECT;
};

const PPS_LETTERS = "WABCDEFGHIJKLMNOPQRSTUV";

/**
 * Irish PPS number: check letter = PPS_LETTERS[(sum of (8 - i) x digit i over the seven digits,
 * plus 9 x the index of the second letter when it is A, B or H) mod 23].
 */
export const ie_pps: Validator = (matched) => {
  const m = /^([0-9]{7})([A-W])([ABHWTX]?)$/.exec(matched);
  if (m === null) return REJECT;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (8 - i) * Number((m[1] as string)[i]);
  const second = m[3] as string;
  if (second === "A" || second === "B" || second === "H") sum += 9 * PPS_LETTERS.indexOf(second);
  return PPS_LETTERS[sum % 23] === m[2] ? ACCEPT : REJECT;
};

const CF_ODD: Readonly<Record<string, number>> = Object.freeze({
  "0": 1,
  "1": 0,
  "2": 5,
  "3": 7,
  "4": 9,
  "5": 13,
  "6": 15,
  "7": 17,
  "8": 19,
  "9": 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
});
const CF_OMOCODIA = "LMNPQRSTUV";
const CF_MONTHS = "ABCDEHLMPRST";

function cfEven(ch: string): number {
  return ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 65;
}

/** Italian codice fiscale: omocodia letters decoded, a real date (day + 40 for women), check letter. */
export const it_cf: Validator = (matched) => {
  if (
    !/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(
      matched,
    )
  ) {
    return REJECT;
  }
  const num = (ch: string): number => {
    const o = CF_OMOCODIA.indexOf(ch);
    return o >= 0 ? o : ch.charCodeAt(0) - 48;
  };
  const yy = num(matched[6] as string) * 10 + num(matched[7] as string);
  const month = CF_MONTHS.indexOf(matched[8] as string) + 1;
  let day = num(matched[9] as string) * 10 + num(matched[10] as string);
  if (day > 40) day -= 40;
  if (!isRealInAnyCentury(yy, month, day, [1900, 2000])) return REJECT;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = matched[i] as string;
    sum += i % 2 === 0 ? (CF_ODD[ch] as number) : cfEven(ch);
  }
  return String.fromCharCode(65 + (sum % 26)) === matched[15] ? ACCEPT : REJECT;
};

/**
 * Norwegian birth number: a real date (day + 40 for D-numbers, month + 40 for H-numbers, day 80
 * or more refused, any century) and the two mod-11 check digits.
 */
export const no_fnr: Validator = (matched) => {
  const d = digitsOf(matched);
  if (d.length !== 11) return REJECT;
  let dd = Number(d.slice(0, 2));
  let mm = Number(d.slice(2, 4));
  const yy = Number(d.slice(4, 6));
  if (dd >= 80) return REJECT;
  if (dd > 40) dd -= 40;
  if (mm > 40) mm -= 40;
  if (!isRealInAnyCentury(yy, mm, dd, [1800, 1900, 2000])) return REJECT;
  const k1 = (11 - (weightedSum(d, [3, 7, 6, 1, 8, 9, 4, 5, 2]) % 11)) % 11;
  const k2 = (11 - (weightedSum(d, [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]) % 11)) % 11;
  return k1 === Number(d[9]) && k2 === Number(d[10]) ? ACCEPT : REJECT;
};

/**
 * Swedish personnummer, `YYMMDD-NNNN`, `YYMMDD+NNNN` or `YYYYMMDD-NNNN`: a real date (day + 60 for
 * coordination numbers; any century when the year has two digits) and Luhn over the last ten digits.
 */
export const se_pnr: Validator = (matched) => {
  let m = /^([0-9]{2})([0-9]{2})([0-9]{2})[-+]([0-9]{4})$/.exec(matched);
  let centuries: number[] = [1800, 1900, 2000];
  let yy: number;
  let mm: number;
  let dd: number;
  let tail: string;
  if (m !== null) {
    yy = Number(m[1]);
    mm = Number(m[2]);
    dd = Number(m[3]);
    tail = (m[1] as string) + (m[2] as string) + (m[3] as string) + (m[4] as string);
  } else {
    m = /^([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})-([0-9]{4})$/.exec(matched);
    if (m === null) return REJECT;
    centuries = [Number(m[1]) * 100];
    yy = Number(m[2]);
    mm = Number(m[3]);
    dd = Number(m[4]);
    tail = (m[2] as string) + (m[3] as string) + (m[4] as string) + (m[5] as string);
  }
  if (dd > 60) dd -= 60;
  if (!isRealInAnyCentury(yy, mm, dd, centuries)) return REJECT;
  return luhnValid(tail) ? ACCEPT : REJECT;
};

const ok = (b: boolean): ValidatorResult => (b ? ACCEPT : REJECT);

function vatAt(rest: string): ValidatorResult {
  const m = /^U([0-9]{7})([0-9])$/.exec(rest);
  if (m === null) return REJECT;
  let s = 0;
  for (let i = 0; i < 7; i++) {
    let v = Number((m[1] as string)[i]) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    s += v;
  }
  return ok((((6 - s) % 10) + 10) % 10 === Number(m[2]));
}

function vatBe(rest: string): ValidatorResult {
  if (!/^[01][0-9]{9}$/.test(rest)) return REJECT;
  return ok((Number(rest.slice(0, 8)) + Number(rest.slice(8))) % 97 === 0);
}

function vatDe(rest: string): ValidatorResult {
  if (!/^[1-9][0-9]{8}$/.test(rest)) return REJECT;
  let product = 10;
  for (let i = 0; i < 8; i++) {
    let sum = (Number(rest[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return ok(check === Number(rest[8]));
}

const NIF_CIF_TYPES = "ABCDEFGHJNPQRSUVW";
const CIF_LETTERS = "JABCDEFGHI";

function vatEs(rest: string): ValidatorResult {
  if (!/^[0-9A-Z][0-9]{7}[0-9A-Z]$/.test(rest)) return REJECT;
  const first = rest[0] as string;
  if ("KLM".includes(first)) {
    if (!allDigits(rest.slice(1, 8))) return REJECT;
    return ok(DNI_LETTERS[Number(rest.slice(1, 8)) % 23] === rest[8]);
  }
  if (first >= "0" && first <= "9") return es_dni(rest);
  if ("XYZ".includes(first)) return es_nie(rest);
  if (!NIF_CIF_TYPES.includes(first)) return REJECT;
  // A company number (CIF): the check is the Luhn digit, written as a digit or as a letter.
  const body = rest.slice(1, 8);
  const cs = luhnCheckDigit(body);
  return ok(rest[8] === String(cs) || rest[8] === CIF_LETTERS[cs]);
}

const FR_KEY_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function vatFr(rest: string): ValidatorResult {
  if (!/^[0-9A-HJ-NP-Z]{2}[0-9]{9}$/.test(rest)) return REJECT;
  const key = rest.slice(0, 2);
  const siren = rest.slice(2);
  if (!luhnValid(siren)) return REJECT;
  const n = Number(siren);
  if (allDigits(key)) return ok((12 + 3 * (n % 97)) % 97 === Number(key));
  const c0 = FR_KEY_ALPHABET.indexOf(key[0] as string);
  const c1 = FR_KEY_ALPHABET.indexOf(key[1] as string);
  const cvalue = c0 < 10 ? c0 * 24 + c1 - 10 : c0 * 34 + c1 - 100;
  return ok((n + 1 + Math.floor(cvalue / 11)) % 11 === cvalue % 11);
}

function vatIt(rest: string): ValidatorResult {
  return ok(/^[0-9]{11}$/.test(rest) && luhnValid(rest));
}

function mod97Letters(s: string): number {
  let r = 0;
  for (const ch of s) {
    const v = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
    r = v > 9 ? (r * 100 + v) % 97 : (r * 10 + v) % 97;
  }
  return r;
}

function vatNl(rest: string): ValidatorResult {
  if (!/^[0-9]{9}B[0-9]{2}$/.test(rest)) return REJECT;
  const bsn = rest.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (9 - i) * Number(bsn[i]);
  sum -= Number(bsn[8]);
  if (sum % 11 === 0) return ACCEPT;
  return ok(mod97Letters("NL" + rest) === 1);
}

function vatPl(rest: string): ValidatorResult {
  if (!/^[0-9]{10}$/.test(rest)) return REJECT;
  const sum = weightedSum(rest, [6, 5, 7, 2, 3, 4, 5, 6, 7]);
  return ok(sum % 11 === Number(rest[9]));
}

function vatSe(rest: string): ValidatorResult {
  return ok(/^[0-9]{10}01$/.test(rest) && luhnValid(rest.slice(0, 10)));
}

/**
 * EU VAT number, dispatching on the two-letter country prefix (AT, BE, DE, ES, FR, IT, NL, PL,
 * SE). Spaces after the prefix are ignored. Each country follows §3.5.
 */
export const eu_vat: Validator = (matched) => {
  const s = stripChars(matched, " ");
  const rest = s.slice(2);
  switch (s.slice(0, 2)) {
    case "AT":
      return vatAt(rest);
    case "BE":
      return vatBe(rest);
    case "DE":
      return vatDe(rest);
    case "ES":
      return vatEs(rest);
    case "FR":
      return vatFr(rest);
    case "IT":
      return vatIt(rest);
    case "NL":
      return vatNl(rest);
    case "PL":
      return vatPl(rest);
    case "SE":
      return vatSe(rest);
    default:
      return REJECT;
  }
};
