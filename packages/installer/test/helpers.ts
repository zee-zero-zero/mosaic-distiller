// Test helpers for the installer: temporary sandboxes whose home, settings and data directories
// are all inside one temporary directory, so that no test touches the real ones.
// The platform is the running one, because the command-line tests start the real CLI, which
// resolves its directories for the platform it runs on.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import type { PathEnv } from "../src/paths";
import { pluginsFile } from "../src/paths";
import { scanArray } from "../src/plugins-file";

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function tmp(prefix = "ins-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

/** True in the local and full tiers, where tests may start processes. */
export function spawnTier(): boolean {
  const t = process.env.DISTILLER_TIER;
  return t === "local" || t === "full";
}

export interface Sandbox {
  root: string;
  paths: PathEnv;
  plugins: string;
}

/**
 * A sandbox. With `spaced`, every directory in it lies under a path that contains spaces; no
 * platform's data directory can then avoid them, whichever variable or home it is derived from.
 */
export function sandbox(opts: { spaced?: boolean } = {}): Sandbox {
  const root = tmp();
  const base = opts.spaced === true ? join(root, "dir with spaces") : root;
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  const paths: PathEnv = {
    platform: process.platform,
    home,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(base, "config"),
      XDG_DATA_HOME: join(base, "data"),
      APPDATA: join(base, "appdata"),
      LOCALAPPDATA: join(base, "localappdata"),
    },
  };
  return { root, paths, plugins: pluginsFile(paths) };
}

export function write(path: string, content: string | Buffer, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode !== undefined) chmodSync(path, mode);
}

/** A directory laid out like the built server: server.mjs, rulepacks/default.json, profiles. */
export function fakeServerSource(serverJs = "// a stand-in server\n"): string {
  const dir = tmp("src-");
  write(join(dir, "server.mjs"), serverJs);
  write(join(dir, "rulepacks", "default.json"), "{}");
  write(join(dir, "profiles", "agent.json"), "{}");
  return dir;
}

/** The exact text of each top-level element of a JSON array text that is not the distiller's. */
export function otherSlices(text: string): string[] {
  const l = scanArray(text);
  return l.elements
    .map((e) => text.slice(e.start, e.end))
    .filter((s) => {
      const v = JSON.parse(s) as { name?: unknown; id?: unknown };
      return !(
        v !== null &&
        typeof v === "object" &&
        (v.name === "distiller" || v.id === "0f107eda-796d-44e2-b910-37c18e2bc535")
      );
    });
}

export function oursCount(text: string): number {
  const arr = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown[];
  return arr.filter((v) => {
    const o = v as { name?: string; id?: string } | null;
    return (
      o !== null &&
      typeof o === "object" &&
      (o.name === "distiller" || o.id === "0f107eda-796d-44e2-b910-37c18e2bc535")
    );
  }).length;
}
