// Provides the distillate (§2.9): the original text with the "removed" invisible characters
// deleted, each redacted span replaced by its fake and each neutralised span by its marker.
// Nothing else changes; in particular the text is not normalised. Replacement operations that
// overlap (a neutralised defend span partly inside a redaction) are united, and the redaction's
// replacement covers the union.
import { fromCodePoints } from "./text/codepoints";
import type { ScanView } from "./text/scanview";

export interface Op {
  /** Original code-point range, end exclusive. */
  start: number;
  end: number;
  replacement: string;
  /** True for a redaction, which takes precedence over a neutralisation when they overlap. */
  redact: boolean;
}

export function uniteOps(ops: Op[]): Op[] {
  const sorted = [...ops].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Op[] = [];
  for (const op of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && op.start < last.end) {
      last.end = Math.max(last.end, op.end);
      if (op.redact && !last.redact) {
        last.replacement = op.replacement;
        last.redact = true;
      }
    } else {
      out.push({ ...op });
    }
  }
  return out;
}

export function buildDistillate(view: ScanView, ops: Op[]): string {
  const parts: string[] = [];
  const { original, removed } = view;
  const copy = (from: number, to: number): void => {
    let run = from;
    for (let i = from; i < to; i++) {
      if (removed[i] === 1) {
        if (i > run) parts.push(fromCodePoints(original, run, i));
        run = i + 1;
      }
    }
    if (to > run) parts.push(fromCodePoints(original, run, to));
  };
  let pos = 0;
  for (const op of uniteOps(ops)) {
    copy(pos, op.start);
    parts.push(op.replacement);
    pos = Math.max(pos, op.end);
  }
  copy(pos, original.length);
  return parts.join("");
}
