// Provides the type of a validator (§3.5): a pure function from the matched text to an accept or
// reject answer, which may set the hit's variant. A validator reads no clock and no global state.

export type ValidatorResult = { ok: false } | { ok: true; variant?: string };
/** `after` is up to two characters of the scan view that follow the match, when there are any. */
export type Validator = (matched: string, after?: string) => ValidatorResult;

export const REJECT: ValidatorResult = { ok: false };
export const ACCEPT: ValidatorResult = { ok: true };
export function accept(variant?: string): ValidatorResult {
  return variant === undefined ? ACCEPT : { ok: true, variant };
}
