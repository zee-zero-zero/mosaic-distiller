// Provides ContentFreeLog (§4.5, §4.6): a JSON-lines log whose events are made only of fixed codes
// and numbers, so no string taken from input can reach it. It writes to the server's data
// directory (created owner-only), rotates at 1 MiB keeping two files, and never writes to stdout
// or stderr. A failure to write is swallowed: logging must never stop the server.
import { chmodSync, existsSync, mkdirSync, renameSync, statSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_NAME } from "@mosaic-distiller/core";

/** The events the server logs. */
export type LogCode =
  "start" | "stop" | "call" | "result" | "deadline" | "worker_restart" | "worker_error";
export type LogTool = "distill" | "capabilities" | "other";
export type LogOutcome = "ok" | "refused" | "too_large" | "internal";

/** An event: a code, and only fixed words or numbers besides. There is no free-text field. */
export interface LogEvent {
  code: LogCode;
  tool?: LogTool;
  outcome?: LogOutcome;
  /** Milliseconds the call took. */
  ms?: number;
  /** Bytes of the result text. */
  bytes?: number;
  /** Number of segments in the request. */
  segments?: number;
}

const CODES = new Set<string>([
  "start",
  "stop",
  "call",
  "result",
  "deadline",
  "worker_restart",
  "worker_error",
]);
const TOOLS = new Set<string>(["distill", "capabilities", "other"]);
const OUTCOMES = new Set<string>(["ok", "refused", "too_large", "internal"]);

export const LOG_FILE = "distiller.log";
export const LOG_LIMIT_BYTES = 1024 * 1024;

/** The data directory of §4.6 for an operating system. */
export function dataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA;
    return join(
      base !== undefined && base !== "" ? base : join(home, "AppData", "Local"),
      PACKAGE_NAME,
    );
  }
  if (platform === "darwin") return join(home, "Library", "Application Support", PACKAGE_NAME);
  const xdg = env.XDG_DATA_HOME;
  return join(xdg !== undefined && xdg !== "" ? xdg : join(home, ".local", "share"), PACKAGE_NAME);
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Builds the line for an event, or null if a field is not of its fixed kind. */
export function formatEvent(ev: LogEvent, now: number): string | null {
  if (!CODES.has(ev.code)) return null;
  const out: Record<string, string | number> = { ts: Math.floor(now), code: ev.code };
  if (ev.tool !== undefined) {
    if (!TOOLS.has(ev.tool)) return null;
    out.tool = ev.tool;
  }
  if (ev.outcome !== undefined) {
    if (!OUTCOMES.has(ev.outcome)) return null;
    out.outcome = ev.outcome;
  }
  for (const k of ["ms", "bytes", "segments"] as const) {
    const v = ev[k];
    if (v === undefined) continue;
    if (!finite(v)) return null;
    out[k] = Math.round(v);
  }
  return JSON.stringify(out) + "\n";
}

export class ContentFreeLog {
  private ready = false;

  constructor(
    private readonly dir: string = dataDirectory(),
    private readonly limit: number = LOG_LIMIT_BYTES,
    private readonly clock: () => number = Date.now,
  ) {}

  write(ev: LogEvent): void {
    try {
      const line = formatEvent(ev, this.clock());
      if (line === null) return;
      this.ensureDirectory();
      const file = join(this.dir, LOG_FILE);
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > this.limit) {
        renameSync(file, file + ".1");
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch {
      // Logging never stops the server, and never reports to stdout or stderr.
    }
  }

  private ensureDirectory(): void {
    if (this.ready) return;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") chmodSync(this.dir, 0o700);
    }
    this.ready = true;
  }
}
