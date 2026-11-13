// Provides conversion between JavaScript strings and arrays of Unicode code points. Every
// position the engine reports is an index into such an array (§2.3). A lone surrogate becomes
// U+FFFD, and the caller is told so that it can warn (`LONE_SURROGATE`).

export const REPLACEMENT = 0xfffd;

export function toCodePoints(text: string): { cps: Uint32Array; lone: boolean } {
  const out = new Uint32Array(text.length);
  let n = 0;
  let lone = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        out[n++] = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        i++;
      } else {
        out[n++] = REPLACEMENT;
        lone = true;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out[n++] = REPLACEMENT;
      lone = true;
    } else {
      out[n++] = c;
    }
  }
  return { cps: out.slice(0, n), lone };
}

/** Builds a string from the code points in [start, end). */
export function fromCodePoints(cps: ArrayLike<number>, start = 0, end = cps.length): string {
  const parts: string[] = [];
  const chunk = 4096;
  for (let i = start; i < end; i += chunk) {
    const stop = Math.min(end, i + chunk);
    const codes: number[] = new Array(stop - i);
    for (let k = i; k < stop; k++) codes[k - i] = cps[k] as number;
    parts.push(String.fromCodePoint(...codes));
  }
  return parts.join("");
}
