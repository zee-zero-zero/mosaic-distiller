// Provides the scan view of a segment (§2.3): the segment as code points with invisible
// characters dropped and every remaining code point replaced by its NFKC form, together with the
// map from each scan-view code point back to the original code point it came from, the table from
// UTF-16 index to code-point index, and the runs of "removed" invisible characters.
import { fromCodePoints, toCodePoints } from "./codepoints";

export interface ScanView {
  /** The original segment as code points (a lone surrogate already replaced by U+FFFD). */
  original: Uint32Array;
  /** True when a lone surrogate was replaced. */
  lone: boolean;
  /** The scan view as code points. */
  cps: Uint32Array;
  /** For each scan-view code point, the index of the original code point it came from. */
  origin: Uint32Array;
  /** The scan view as a JavaScript string. */
  str: string;
  /** For each UTF-16 index of `str` (and its length), the scan-view code-point index. */
  u16ToCp: Int32Array;
  /** 1 for each original code point that is a "removed" invisible character. */
  removed: Uint8Array;
  /** Runs of consecutive removed invisible characters, in original coordinates, end exclusive. */
  runs: { start: number; end: number }[];
}

const KIND_NORMAL = 0;
const KIND_REMOVED = 1;
const KIND_KEPT = 2;

function isAsciiAlnum(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** Classifies each original code point as normal, removed-invisible or kept-invisible (§2.3). */
export function classifyInvisible(cps: Uint32Array): Uint8Array {
  const kind = new Uint8Array(cps.length);
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i] as number;
    if (c < 0xad) continue;
    if (c === 0x1f3f4) {
      // An emoji tag sequence: the black flag, tag characters, and the cancel tag.
      let j = i + 1;
      while (j < cps.length && (cps[j] as number) >= 0xe0020 && (cps[j] as number) <= 0xe007e) j++;
      if (j > i + 1 && j < cps.length && cps[j] === 0xe007f) {
        for (let k = i + 1; k <= j; k++) kind[k] = KIND_KEPT;
        i = j;
      }
      continue;
    }
    if (kind[i] !== KIND_NORMAL) continue;
    if (
      c === 0xad ||
      c === 0x180e ||
      c === 0x200b ||
      c === 0x2060 ||
      (c >= 0x2061 && c <= 0x2064) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069) ||
      (c >= 0xfff9 && c <= 0xfffb) ||
      (c >= 0xe0000 && c <= 0xe007f) ||
      (c >= 0xe0100 && c <= 0xe01ef) ||
      (c >= 0xfe00 && c <= 0xfe0d)
    ) {
      kind[i] = KIND_REMOVED;
    } else if (c === 0xfeff) {
      kind[i] = i === 0 ? KIND_KEPT : KIND_REMOVED;
    } else if (c === 0x200c || c === 0x200d) {
      const between =
        i > 0 &&
        i + 1 < cps.length &&
        isAsciiAlnum(cps[i - 1] as number) &&
        isAsciiAlnum(cps[i + 1] as number);
      kind[i] = between ? KIND_REMOVED : KIND_KEPT;
    } else if (c === 0x200e || c === 0x200f || c === 0x61c || c === 0xfe0e || c === 0xfe0f) {
      kind[i] = KIND_KEPT;
    }
  }
  return kind;
}

const nfkcCache = new Map<number, number[]>();

function nfkcOne(c: number): number[] {
  if (c < 0x80) return [c];
  let r = nfkcCache.get(c);
  if (r === undefined) {
    const s = String.fromCodePoint(c).normalize("NFKC");
    r = Array.from(s, (ch) => ch.codePointAt(0) as number);
    if (nfkcCache.size < 65536) nfkcCache.set(c, r);
  }
  return r;
}

// eslint-disable-next-line no-control-regex -- ASCII includes the control characters
const ASCII_ONLY = /^[\u0000-\u007f]*$/;

/**
 * The scan view of a text made only of ASCII characters. ASCII has no invisible character, no
 * surrogate and no NFKC change, so the scan view is the text itself and every map is the identity.
 */
function asciiScanView(text: string): ScanView {
  const n = text.length;
  const original = new Uint32Array(n);
  const origin = new Uint32Array(n);
  const u16ToCp = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    original[i] = text.charCodeAt(i);
    origin[i] = i;
    u16ToCp[i] = i;
  }
  u16ToCp[n] = n;
  return {
    original,
    lone: false,
    cps: original,
    origin,
    str: text,
    u16ToCp,
    removed: new Uint8Array(n),
    runs: [],
  };
}

export function buildScanView(text: string): ScanView {
  if (ASCII_ONLY.test(text)) return asciiScanView(text);
  const { cps: original, lone } = toCodePoints(text);
  const kind = classifyInvisible(original);
  const removed = new Uint8Array(original.length);
  const runs: { start: number; end: number }[] = [];
  const scan: number[] = [];
  const origin: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const k = kind[i] as number;
    if (k === KIND_REMOVED) {
      removed[i] = 1;
      const last = runs[runs.length - 1];
      if (last !== undefined && last.end === i) last.end = i + 1;
      else runs.push({ start: i, end: i + 1 });
      continue;
    }
    if (k === KIND_KEPT) continue;
    const c = original[i] as number;
    if (c < 0x80) {
      scan.push(c);
      origin.push(i);
    } else {
      for (const d of nfkcOne(c)) {
        scan.push(d);
        origin.push(i);
      }
    }
  }
  const cps = Uint32Array.from(scan);
  const str = fromCodePoints(cps);
  const u16ToCp = new Int32Array(str.length + 1);
  let off = 0;
  for (let k = 0; k < cps.length; k++) {
    const w = (cps[k] as number) > 0xffff ? 2 : 1;
    u16ToCp[off] = k;
    if (w === 2) u16ToCp[off + 1] = k;
    off += w;
  }
  u16ToCp[str.length] = cps.length;
  return {
    original,
    lone,
    cps,
    origin: Uint32Array.from(origin),
    str,
    u16ToCp,
    removed,
    runs,
  };
}

/** Maps a non-empty scan-view span to the original range that covers it, end exclusive. */
export function mapSpanToOriginal(view: ScanView, start: number, end: number): [number, number] {
  if (end > start) return [view.origin[start] as number, (view.origin[end - 1] as number) + 1];
  // A zero-length span sits just after the scan-view character before it.
  return start > 0
    ? [(view.origin[start - 1] as number) + 1, (view.origin[start - 1] as number) + 1]
    : [0, 0];
}
