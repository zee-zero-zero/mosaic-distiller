// Provides what the server's tests share: the paths of the built server, the tier switch (tests
// that start processes run in the local and full tiers only, after the global set-up has built the
// bundle), temporary directories, and a starter that runs the server with a private home, data
// directory and environment so that a test never touches the real ones.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpHarness, type Entry, type StartOptions } from "@mosaic-distiller/mcp-harness";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DIST = join(ROOT, "packages/server/dist");

/** True in the local and full tiers, where the server is built and processes may be started. */
export const canSpawn =
  process.env.DISTILLER_TIER === "local" || process.env.DISTILLER_TIER === "full";

/** The `env` the installer writes in MosAIc's entry (§6.3). */
export const ENTRY_ENV = { NODE_OPTIONS: "", NODE_PATH: "" };

const dirs: string[] = [];
export function tmpDir(prefix = "srv-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
export function cleanTmp(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export interface Sandbox {
  home: string;
  xdg: string;
  /** The directory the server logs to. */
  dataDir: string;
  env: Record<string, string>;
}
export function sandbox(extra: Record<string, string> = {}): Sandbox {
  const home = tmpDir("srv-home-");
  const xdg = join(home, "xdg-data");
  mkdirSync(xdg, { recursive: true });
  return {
    home,
    xdg,
    dataDir: join(xdg, "ai-distiller"),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      XDG_DATA_HOME: xdg,
      XDG_CONFIG_HOME: join(home, "xdg-config"),
      LANG: "C.UTF-8",
      ...extra,
    },
  };
}

export interface Started {
  harness: McpHarness;
  box: Sandbox;
}

/** Starts a built entry (`server` or `test-entry`) as MosAIc would, in a sandbox. */
export async function startBuilt(
  which: "server" | "test-entry" = "server",
  options: {
    parentEnv?: Record<string, string>;
    entryEnv?: Record<string, string | undefined>;
    dir?: string;
    mode?: StartOptions["mode"];
  } = {},
): Promise<Started> {
  const box = sandbox();
  const entry: Entry = {
    command: process.execPath,
    args: [join(options.dir ?? DIST, `${which}.mjs`)],
    env: options.entryEnv ?? ENTRY_ENV,
  };
  const harness = await McpHarness.start(entry, {
    parentEnv: { ...box.env, ...(options.parentEnv ?? {}) },
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
  });
  return { harness, box };
}

/** Copies the built server, with its pack and profiles and nothing else, to a new directory. */
export function lonelyCopy(): string {
  const dir = tmpDir("srv-lone-");
  cpSync(join(DIST, "server.mjs"), join(dir, "server.mjs"));
  cpSync(join(DIST, "rulepacks"), join(dir, "rulepacks"), { recursive: true });
  cpSync(join(DIST, "profiles"), join(dir, "profiles"), { recursive: true });
  return dir;
}

/** A copy of MosAIc's payment-signal detector, as the specification describes it (§5.8, QRK-3). */
export function detectsPaymentSignal(text: string): boolean {
  if (!text.includes('"__payment_required"')) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).__payment_required === true
    );
  } catch {
    return false;
  }
}

/** The stricter check the tests use: no trace of any of the three markers, in any case. */
export function carriesMarker(text: string): boolean {
  return /<use_tool|<mosaic_ui|__payment_required/i.test(text);
}
