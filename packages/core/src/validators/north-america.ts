// Provides the North American validators of §3.5: ssn_rules, itin_rules, ca_bn and nanp_rules.
import { ACCEPT, REJECT, accept } from "./types";
import type { Validator } from "./types";
import { digitsOf, luhnValid } from "./util";

const SSN_VOIDED = ["078-05-1120", "219-09-9999", "123-45-6789"];

/** US SSN: area not 000, 666 or 900 to 999; group not 00; serial not 0000; no known voided number. */
export const ssn_rules: Validator = (matched) => {
  const m = /^([0-9]{3})-([0-9]{2})-([0-9]{4})$/.exec(matched);
  if (m === null) return REJECT;
  const area = Number(m[1]);
  if (area === 0 || area === 666 || area >= 900) return REJECT;
  if (m[2] === "00" || m[3] === "0000") return REJECT;
  return SSN_VOIDED.includes(matched) ? REJECT : ACCEPT;
};

/** US ITIN: first digit 9; digits 4 and 5 in 50-65, 70-88, 90-92 or 94-99; 93 is an ATIN. */
export const itin_rules: Validator = (matched) => {
  const m = /^(9[0-9]{2})-([0-9]{2})-([0-9]{4})$/.exec(matched);
  if (m === null) return REJECT;
  const g = Number(m[2]);
  if (g === 93) return accept("atin");
  const ok = (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || g >= 94;
  return ok ? ACCEPT : REJECT;
};

/** Canadian business number: Luhn over its nine digits (the program account is not checked). */
export const ca_bn: Validator = (matched) => {
  const m = /^([0-9]{9})[ ]?R[CMPRTZ][ ]?[0-9]{4}$/.exec(matched);
  return m !== null && luhnValid(m[1] as string) ? ACCEPT : REJECT;
};

/**
 * NANP: area and exchange codes of the form [2-9]XX and not N11, and not the fictional range
 * 555-0100 to 555-0199. A leading country code 1 is allowed.
 */
export const nanp_rules: Validator = (matched) => {
  let d = digitsOf(matched);
  if (d.length === 11) {
    if (d[0] !== "1") return REJECT;
    d = d.slice(1);
  }
  if (d.length !== 10) return REJECT;
  const area = d.slice(0, 3);
  const exchange = d.slice(3, 6);
  const line = Number(d.slice(6));
  for (const code of [area, exchange]) {
    if (code[0] === "0" || code[0] === "1") return REJECT;
    if (code[1] === "1" && code[2] === "1") return REJECT;
  }
  if (exchange === "555" && line >= 100 && line <= 199) return REJECT;
  return ACCEPT;
};
