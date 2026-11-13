// Provides the small pure helpers the validators share: digit extraction, calendar checks that do
// not read the clock, Luhn, and string arithmetic. Nothing here reads the date, the locale or any
// global state, so every validator built on it gives the same answer on every machine (§2.4.5).

export function isAsciiDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9" && ch.length === 1;
}

export function isAsciiAlnum(ch: string): boolean {
  return (
    ch.length === 1 &&
    ((ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z"))
  );
}

/** Only the ASCII digits of `s`, in order. */
export function digitsOf(s: string): string {
  let out = "";
  for (const ch of s) if (isAsciiDigit(ch)) out += ch;
  return out;
}

/** True when `s` is non-empty and made only of ASCII digits. */
export function allDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

/** `s` without any character found in `drop`. */
export function stripChars(s: string, drop: string): string {
  let out = "";
  for (const ch of s) if (!drop.includes(ch)) out += ch;
  return out;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A real calendar date in the proleptic Gregorian calendar. */
export function isRealDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** The date is real in at least one of the given centuries (the century is ambiguous). */
export function isRealInAnyCentury(yy: number, m: number, d: number, centuries: number[]): boolean {
  return centuries.some((c) => isRealDate(c + yy, m, d));
}

/** The remainder of a long digit string divided by `m`, without leaving the safe integer range. */
export function modDigits(digits: string, m: number): number {
  let r = 0;
  for (const ch of digits) r = (r * 10 + (ch.charCodeAt(0) - 48)) % m;
  return r;
}

/** Luhn mod 10 over a digit string: valid when the sum is a multiple of ten. */
export function luhnValid(digits: string): boolean {
  if (digits.length === 0 || !allDigits(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The Luhn check digit to append to `body`. */
export function luhnCheckDigit(body: string): number {
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let d = body.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Weighted sum of the digits of `digits` with `weights` (same length). */
export function weightedSum(digits: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (digits.charCodeAt(i) - 48) * (weights[i] as number);
  }
  return sum;
}
