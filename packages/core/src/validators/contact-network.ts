// Provides the contact and network validators of §3.5: email_shape, ipv4_scope, ipv6_parse and
// mac_not_reserved. Values reserved for documentation or fiction are never hits (§2.4.6).
import { ACCEPT, REJECT, accept } from "./types";
import type { Validator } from "./types";

const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["example", "invalid", "test", "localhost"];
const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "avif",
];

/**
 * E-mail address shape: no leading, trailing or doubled dot in the local part; no domain label
 * starting or ending with a hyphen; an alphabetic top-level label of 2 to 63 letters; not an image
 * file name such as `icon@2x.png`; not a reserved domain.
 *
 * An ssh remote `git@host:path` is refused when the local part is `git` and the text after the
 * match, passed as `after`, starts with `:`. When `after` is not given the validator cannot see
 * that colon, so it refuses every local part `git`.
 */
export const email_shape: Validator = (matched: string, after?: string) => {
  const at = matched.indexOf("@");
  if (at < 1 || matched.indexOf("@", at + 1) >= 0) return REJECT;
  const local = matched.slice(0, at);
  const domain = matched.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return REJECT;
  if (local === "git" && (after === undefined || after.startsWith(":"))) return REJECT;
  const labels = domain.split(".");
  if (labels.length < 2) return REJECT;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return REJECT;
    if (label.startsWith("-") || label.endsWith("-")) return REJECT;
  }
  const tld = labels[labels.length - 1] as string;
  if (!/^[A-Za-z]{2,63}$/.test(tld)) return REJECT;
  const lower = domain.toLowerCase();
  const lowerTld = tld.toLowerCase();
  if (IMAGE_EXTENSIONS.includes(lowerTld)) return REJECT;
  if (RESERVED_TLDS.includes(lowerTld)) return REJECT;
  for (const r of RESERVED_DOMAINS) if (lower === r || lower.endsWith("." + r)) return REJECT;
  return ACCEPT;
};

/**
 * IPv4 address: refuses 0.0.0.0/8 and the documentation ranges 192.0.2/24, 198.51.100/24 and
 * 203.0.113/24; sets the variant private (10/8, 172.16/12, 192.168/16), loopback (127/8) or
 * link_local (169.254/16).
 */
export const ipv4_scope: Validator = (matched) => {
  const parts = matched.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^[0-9]{1,3}$/.test(p))) return REJECT;
  const [a, b, c] = parts.map(Number) as [number, number, number, number];
  if (parts.some((p) => Number(p) > 255)) return REJECT;
  if (a === 0) return REJECT;
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100)) return REJECT;
  if (a === 203 && b === 0 && c === 113) return REJECT;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return accept("private");
  }
  if (a === 127) return accept("loopback");
  if (a === 169 && b === 254) return accept("link_local");
  return ACCEPT;
};

/**
 * IPv6 text form: eight groups of one to four hex digits, or fewer with a single `::`; at least
 * three non-empty groups; not inside 2001:db8::/32.
 */
export const ipv6_parse: Validator = (matched) => {
  if (!/^[0-9A-Fa-f:]+$/.test(matched) || matched.includes(":::")) return REJECT;
  const halves = matched.split("::");
  if (halves.length > 2) return REJECT;
  const groupsOf = (s: string): string[] => (s === "" ? [] : s.split(":"));
  const head = groupsOf(halves[0] as string);
  const tail = halves.length === 2 ? groupsOf(halves[1] as string) : [];
  const all = [...head, ...tail];
  if (!all.every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g))) return REJECT;
  if (halves.length === 1 ? all.length !== 8 : all.length > 7) return REJECT;
  if (all.length < 3) return REJECT;
  if (head.length >= 2 && Number.parseInt(head[0] as string, 16) === 0x2001) {
    if (Number.parseInt(head[1] as string, 16) === 0x0db8) return REJECT;
  }
  return ACCEPT;
};

/** MAC address: not all zeros, not all ones, not 00:00:5e:00:53:00 to 00:00:5e:00:53:ff. */
export const mac_not_reserved: Validator = (matched) => {
  const parts = matched.toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-f]{2}$/.test(p))) return REJECT;
  const joined = parts.join("");
  if (joined === "000000000000" || joined === "ffffffffffff") return REJECT;
  return joined.startsWith("00005e0053") ? REJECT : ACCEPT;
};
