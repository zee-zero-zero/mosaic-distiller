// Provides the byte-preserving edit of MosAIc's `mcp-plugins.json` (§6.3, step 3). `editPluginsText`
// adds or replaces the distiller's entry, or removes it, and keeps the text of every other entry
// exactly as it was, by slicing the original text instead of serialising it again. `applyEdit`
// does the whole job on disk: it refuses an unparseable, non-array or read-only file, writes a
// backup, writes a temporary file and renames it over the original.
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";

/** The fixed id of the distiller's entry (§6.3). */
export const ENTRY_ID = "0f107eda-796d-44e2-b910-37c18e2bc535";
export const ENTRY_NAME = "distiller";

export interface DistillerEntry {
  id: string;
  name: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: { NODE_OPTIONS: string; NODE_PATH: string };
  autoConnect: true;
}

export function makeEntry(nodePath: string, serverFile: string): DistillerEntry {
  return {
    id: ENTRY_ID,
    name: ENTRY_NAME,
    description: "Replaces sensitive values in text with fake ones",
    transport: "stdio",
    command: nodePath,
    args: [serverFile],
    env: { NODE_OPTIONS: "", NODE_PATH: "" },
    autoConnect: true,
  };
}

export type PluginsEdit = { kind: "upsert"; entry: DistillerEntry } | { kind: "remove" };

export type EditResult =
  | { ok: true; text: string; changed: boolean; oursBefore: number }
  | { ok: false; code: "MALFORMED" | "NOT_ARRAY"; message: string };

interface Element {
  lead: string;
  start: number;
  end: number;
}
interface Layout {
  open: number;
  close: number;
  elements: Element[];
  tail: string;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const WS = new Set([" ", "\t", "\n", "\r"]);

function skipWs(t: string, i: number): number {
  while (i < t.length && WS.has(t[i] as string)) i++;
  return i;
}

/** The index just after the string that starts at `i` (a `"`). */
function skipString(t: string, i: number): number {
  i++;
  while (i < t.length) {
    const c = t[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  return i;
}

/** The index just after the JSON value that starts at `i`, in text already known to be valid. */
function skipValue(t: string, i: number): number {
  const c = t[i];
  if (c === '"') return skipString(t, i);
  if (c === "{" || c === "[") {
    let depth = 0;
    while (i < t.length) {
      const d = t[i];
      if (d === '"') {
        i = skipString(t, i);
        continue;
      }
      if (d === "{" || d === "[") depth++;
      else if (d === "}" || d === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return i;
  }
  while (i < t.length && !WS.has(t[i] as string) && t[i] !== "," && t[i] !== "]") i++;
  return i;
}

/** Locates the top-level array and the text slice of each of its elements. Valid JSON only. */
export function scanArray(text: string): Layout {
  const open = skipWs(text, text.charCodeAt(0) === 0xfeff ? 1 : 0);
  const elements: Element[] = [];
  let i = open + 1;
  for (;;) {
    const ws = i;
    i = skipWs(text, i);
    if (i >= text.length) throw new Error("the text is not a complete JSON array");
    if (text[i] === "]") return { open, close: i, elements, tail: text.slice(ws, i) };
    const start = i;
    const end = skipValue(text, i);
    elements.push({ lead: text.slice(ws, start), start, end });
    const next = skipWs(text, end);
    i = text[next] === "," ? next + 1 : end;
  }
}

function isOurs(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.name === ENTRY_NAME || o.id === ENTRY_ID;
}

function renderEntry(entry: DistillerEntry, lead: string, compact: boolean): string {
  if (compact) return JSON.stringify(entry);
  const nl = lead.lastIndexOf("\n");
  const indent = nl >= 0 ? lead.slice(nl + 1) : "  ";
  const eol = lead.includes("\r\n") ? "\r\n" : "\n";
  const unit = indent === "" ? "  " : indent;
  return JSON.stringify(entry, null, unit)
    .split("\n")
    .join(eol + indent);
}

/**
 * Applies `edit` to the text of `mcp-plugins.json`; `original` is null for an absent file. An empty
 * or blank file counts as `[]`.
 */
export function editPluginsText(original: string | null, edit: PluginsEdit): EditResult {
  const blank = original === null || stripBom(original).trim() === "";
  const bom = original !== null && original.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const text = blank ? bom + "[]" : (original as string);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch {
    return { ok: false, code: "MALFORMED", message: "the file is not valid JSON" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, code: "NOT_ARRAY", message: "the file does not hold a JSON array" };
  }
  const layout = scanArray(text);
  if (edit.kind === "remove" && !parsed.some(isOurs)) {
    return { ok: true, text: original ?? "", changed: false, oursBefore: 0 };
  }
  const oursIdx = parsed.map((v, i) => (isOurs(v) ? i : -1)).filter((i) => i >= 0);
  const firstOurs = oursIdx[0];
  const parts: string[] = [];
  const lastLead =
    layout.elements.length > 0
      ? (layout.elements[layout.elements.length - 1] as Element).lead
      : "\n  ";
  const compact =
    layout.elements.length > 0 && layout.elements.every((e) => !e.lead.includes("\n"));
  let tail = layout.tail;
  layout.elements.forEach((e, i) => {
    if (!oursIdx.includes(i)) {
      parts.push(e.lead + text.slice(e.start, e.end));
    } else if (edit.kind === "upsert" && i === firstOurs) {
      parts.push(e.lead + renderEntry(edit.entry, e.lead, compact));
    }
  });
  if (edit.kind === "upsert" && firstOurs === undefined) {
    const lead = layout.elements.length > 0 ? lastLead : "\n  ";
    parts.push(lead + renderEntry(edit.entry, lead, compact));
    if (layout.elements.length === 0) tail = text.includes("\r\n") ? "\r\n" : "\n";
  }
  let out = text.slice(0, layout.open + 1) + parts.join(",") + tail + text.slice(layout.close);
  if (blank) out += out.endsWith("\n") ? "" : "\n";
  const changed = original === null || out !== original;
  return { ok: true, text: out, changed, oursBefore: oursIdx.length };
}

/** The file system calls `applyEdit` makes; a test replaces `rename` with a function that throws. */
export interface FsOps {
  rename(from: string, to: string): void;
}
export const realFsOps: FsOps = { rename: renameSync };

export type ApplyResult =
  | { ok: true; changed: boolean; created: boolean; oursBefore: number; backup: string | null }
  | { ok: false; message: string };

/** Reads the file as text; null when absent. Throws when the bytes are not valid UTF-8. */
function readText(path: string): string | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const text = buf.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buf)) throw new Error("the file is not valid UTF-8");
  return text;
}

/** Edits the file at `path` as described in the header; with `dryRun` it only checks. Throws only on an I/O failure. */
export function applyEdit(
  path: string,
  edit: PluginsEdit,
  fsOps: FsOps = realFsOps,
  dryRun = false,
): ApplyResult {
  let original: string | null;
  try {
    original = readText(path);
  } catch (e) {
    return { ok: false, message: `${path}: ${(e as Error).message}; it was left untouched.` };
  }
  const result = editPluginsText(original, edit);
  if (!result.ok) {
    return {
      ok: false,
      message: `${path}: ${result.message}; it was left untouched. Fix or remove it, then run again.`,
    };
  }
  if (!result.changed || (original === null && edit.kind === "remove")) {
    return {
      ok: true,
      changed: false,
      created: false,
      oursBefore: result.oursBefore,
      backup: null,
    };
  }
  if (original !== null) {
    try {
      accessSync(path, constants.W_OK);
    } catch {
      return {
        ok: false,
        message: `${path} is read-only; it was left untouched. Make it writable, then run again.`,
      };
    }
  }
  if (dryRun) {
    return {
      ok: true,
      changed: true,
      created: original === null,
      oursBefore: result.oursBefore,
      backup: null,
    };
  }
  let backup: string | null = null;
  if (original !== null) {
    backup = `${path}.bak`;
    copyFileSync(path, backup);
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    const fd = openSync(tmp, "w", 0o644);
    try {
      writeSync(fd, result.text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (original !== null) chmodSync(tmp, statSync(path).mode & 0o7777);
    fsOps.rename(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temporary file may not exist */
    }
    throw e;
  }
  return {
    ok: true,
    changed: true,
    created: original === null,
    oursBefore: result.oursBefore,
    backup,
  };
}

/** Reads the entry of ours from the file, or null (absent file, no entry, or an unreadable file). */
export function readOurEntry(path: string): Record<string, unknown> | null {
  try {
    const text = readText(path);
    if (text === null) return null;
    const v: unknown = JSON.parse(stripBom(text));
    if (!Array.isArray(v)) return null;
    const hit = v.find(isOurs);
    return hit === undefined ? null : (hit as Record<string, unknown>);
  } catch {
    return null;
  }
}
