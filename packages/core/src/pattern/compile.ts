// Provides the compiler from a pattern of the portable subset to a JavaScript RegExp (§2.4.2).
// Flags are `g` and `u`, plus `i` when the rule has `i`, plus `d` when the pattern has a capture
// group. The rule's `m` flag is never passed to JavaScript, whose own `m` treats \r, U+2028 and
// U+2029 as line breaks; instead `^` becomes "start, or after U+000A" and `$` becomes "end, or
// before U+000A". A global regexp is driven by `lastIndex` (the scan, scan.ts).
import { RulePackError } from "../schema";
import { fromCodePoints } from "../text/codepoints";
import { parsePattern } from "./subset";

export interface CompiledPattern {
  re: RegExp;
  hasCapture: boolean;
}

export function compilePattern(pattern: string, flags: string): CompiledPattern {
  const parsed = parsePattern(pattern);
  const multiline = flags.includes("m");
  let source: string;
  if (multiline && parsed.anchors.length > 0) {
    const cps = parsed.cps;
    const parts: string[] = [];
    let last = 0;
    for (const a of parsed.anchors) {
      parts.push(fromCodePoints(cps, last, a.index));
      parts.push(a.char === "^" ? "(?:^|(?<=\\n))" : "(?:$|(?=\\n))");
      last = a.index + 1;
    }
    parts.push(fromCodePoints(cps, last, cps.length));
    source = parts.join("");
  } else {
    source = pattern;
  }
  const jsFlags = "gu" + (flags.includes("i") ? "i" : "") + (parsed.groups > 0 ? "d" : "");
  try {
    return { re: new RegExp(source, jsFlags), hasCapture: parsed.groups > 0 };
  } catch {
    throw new RulePackError("PACK_PATTERN_COMPILE", "the pattern does not compile");
  }
}
