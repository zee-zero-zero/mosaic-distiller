// Provides the two small validators that the secret rules of §3.4 name: not_git, which keeps an
// ssh remote's user-info `git`, and not_mask, which leaves a value that is already masked alone.
import { ACCEPT, REJECT } from "./types";
import type { Validator } from "./types";

/**
 * The input is a `scheme://userinfo@` match. Rejects when the user-info (the text between the
 * first `://` and the final `@`) is exactly `git`.
 */
export const not_git: Validator = (matched) => {
  const start = matched.indexOf("://");
  if (start < 0) return ACCEPT;
  const end = matched.endsWith("@") ? matched.length - 1 : matched.length;
  return matched.slice(start + 3, end) === "git" ? REJECT : ACCEPT;
};

const MASK_BEFORE = [":", "=", "/", " ", "\t", '"', "'"];

/**
 * Rejects when the match, with one trailing `@` or quote removed, ends with a run of three or more
 * `*` whose preceding character is one of `: = / space tab " '`: the value was masked already, so
 * running the distiller again on a distillate changes nothing.
 */
export const not_mask: Validator = (matched) => {
  const s = /[@"']$/.test(matched) ? matched.slice(0, -1) : matched;
  let i = s.length;
  while (i > 0 && s[i - 1] === "*") i--;
  const stars = s.length - i;
  if (stars >= 3 && i > 0 && MASK_BEFORE.includes(s[i - 1] as string)) return REJECT;
  return ACCEPT;
};
