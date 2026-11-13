// Provides the Latin American and African validators of §3.5: br_cpf, br_cnpj, mx_curp and
// za_id.
import { ACCEPT, REJECT } from "./types";
import type { Validator } from "./types";
import { isRealDate, isRealInAnyCentury, luhnValid, stripChars } from "./util";

function cpfDigit(digits: number[], firstWeight: number): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += (digits[i] as number) * (firstWeight - i);
  return ((11 - (sum % 11)) % 11) % 10;
}

/** Brazil CPF: two check digits, weights 10 to 2 then 11 to 2; not a single repeated digit. */
export const br_cpf: Validator = (matched) => {
  const s = stripChars(matched, ".-");
  if (!/^[0-9]{11}$/.test(s)) return REJECT;
  if (/^(.)\1*$/.test(s)) return REJECT;
  const d = s.split("").map(Number);
  if (cpfDigit(d.slice(0, 9), 10) !== d[9]) return REJECT;
  return cpfDigit(d.slice(0, 10), 11) === d[10] ? ACCEPT : REJECT;
};

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function cnpjDigit(values: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += (values[i] as number) * (weights[i] as number);
  return ((11 - (sum % 11)) % 11) % 10;
}

/** Brazil CNPJ, including the alphanumeric form: value = code - 48, two check digits. */
export const br_cnpj: Validator = (matched) => {
  const s = stripChars(matched, "./-");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(s)) return REJECT;
  const v = s.split("").map((c) => c.charCodeAt(0) - 48);
  if (cnpjDigit(v, CNPJ_W1) !== v[12]) return REJECT;
  return cnpjDigit(v, CNPJ_W2) === v[13] ? ACCEPT : REJECT;
};

const CURP_ALPHABET = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ";
const CURP_STATES = [
  "AS",
  "BC",
  "BS",
  "CC",
  "CL",
  "CM",
  "CS",
  "CH",
  "DF",
  "DG",
  "GT",
  "GR",
  "HG",
  "JC",
  "MC",
  "MN",
  "MS",
  "NT",
  "NL",
  "OC",
  "PL",
  "QT",
  "QR",
  "SP",
  "SL",
  "SR",
  "TC",
  "TS",
  "TL",
  "VZ",
  "YN",
  "ZS",
  "NE",
];

/**
 * Mexico CURP: a real birth date (the century from character 17: a digit means the 1900s, a
 * letter the 2000s), sex H or M, a state code from the list of 33, and the check digit.
 */
export const mx_curp: Validator = (matched) => {
  if (!/^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$/.test(matched)) return REJECT;
  const c17 = matched[16] as string;
  const century = c17 >= "0" && c17 <= "9" ? 1900 : 2000;
  const yy = Number(matched.slice(4, 6));
  if (!isRealDate(century + yy, Number(matched.slice(6, 8)), Number(matched.slice(8, 10)))) {
    return REJECT;
  }
  if (!CURP_STATES.includes(matched.slice(11, 13))) return REJECT;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const idx = CURP_ALPHABET.indexOf(matched[i] as string);
    if (idx < 0) return REJECT;
    sum += idx * (18 - i);
  }
  return (10 - (sum % 10)) % 10 === Number(matched[17]) ? ACCEPT : REJECT;
};

/** South Africa ID number: a real date in either century, digit 11 is 0 or 1, Luhn over 13 digits. */
export const za_id: Validator = (matched) => {
  if (!/^[0-9]{13}$/.test(matched)) return REJECT;
  if (
    !isRealInAnyCentury(
      Number(matched.slice(0, 2)),
      Number(matched.slice(2, 4)),
      Number(matched.slice(4, 6)),
      [1900, 2000],
    )
  ) {
    return REJECT;
  }
  if (matched[10] !== "0" && matched[10] !== "1") return REJECT;
  return luhnValid(matched) ? ACCEPT : REJECT;
};
