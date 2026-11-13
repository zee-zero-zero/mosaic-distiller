// Provides `findNode` (§6.3, step 1): finds a Node.js of version 20 or newer and returns its
// absolute path. Candidates, in order: the running Node, every `PATH` directory, the Homebrew and
// /usr/local directories, and the default of nvm. Each candidate is asked for its version by
// running it, so that a stale or broken file is never recorded.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export const MIN_NODE_MAJOR = 20;

export interface FindNodeOptions {
  execPath: string;
  /** The value of `PATH`, or undefined. */
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  home: string;
  /** The environment, for `NVM_DIR`. */
  env?: Record<string, string | undefined>;
  /** Runs a candidate with `--version` and returns its output, or null when it cannot run. */
  run?: (candidate: string) => string | null;
}

export type FindNodeResult =
  { ok: true; path: string; version: string } | { ok: false; message: string; tried: string[] };

function defaultRun(candidate: string): string | null {
  try {
    return execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The major version of the output of `node --version`, or null. */
export function parseNodeVersion(out: string): { major: number; text: string } | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(out);
  if (m === null) return null;
  return { major: Number(m[1]), text: `v${m[1]}.${m[2]}.${m[3]}` };
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Resolves nvm's default alias to the directory name of an installed version, or null. */
function nvmDefaultVersionDir(nvmDir: string): string | null {
  const versionsDir = join(nvmDir, "versions", "node");
  let installed: string[];
  try {
    installed = readdirSync(versionsDir).filter((n) => /^v\d+\.\d+\.\d+$/.test(n));
  } catch {
    return null;
  }
  installed.sort(compareVersions);
  let spec: string;
  try {
    spec = readFileSync(join(nvmDir, "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }
  for (let hop = 0; hop < 6; hop++) {
    if (spec === "node" || spec === "stable" || spec === "") break;
    if (/^v?\d+(\.\d+){0,2}$/.test(spec)) {
      const prefix = spec.startsWith("v") ? spec : `v${spec}`;
      const hits = installed.filter((n) => n === prefix || n.startsWith(prefix + "."));
      return hits.length > 0 ? (hits[hits.length - 1] as string) : null;
    }
    if (!/^[A-Za-z0-9*._/-]+$/.test(spec) || spec.includes("..")) return null;
    try {
      spec = readFileSync(join(nvmDir, "alias", spec), "utf8").trim();
    } catch {
      return null;
    }
  }
  return installed.length > 0 ? (installed[installed.length - 1] as string) : null;
}

export function findNode(o: FindNodeOptions): FindNodeResult {
  const run = o.run ?? defaultRun;
  const exe = o.platform === "win32" ? "node.exe" : "node";
  const candidates: string[] = [];
  const add = (c: string): void => {
    if (isAbsolute(c) && !candidates.includes(c)) candidates.push(c);
  };
  add(o.execPath);
  for (const dir of (o.pathEnv ?? "").split(delimiter)) {
    if (dir !== "") add(join(dir, exe));
  }
  if (o.platform !== "win32") {
    add("/opt/homebrew/bin/node");
    add("/usr/local/bin/node");
  }
  const nvmDir = o.env?.NVM_DIR ?? join(o.home, ".nvm");
  const v = nvmDefaultVersionDir(nvmDir);
  if (v !== null) add(join(nvmDir, "versions", "node", v, "bin", "node"));

  const tried: string[] = [];
  for (const c of candidates) {
    const out = run(c);
    if (out === null) continue;
    const ver = parseNodeVersion(out);
    tried.push(ver === null ? `${c} (unreadable version)` : `${c} (${ver.text})`);
    if (ver !== null && ver.major >= MIN_NODE_MAJOR)
      return { ok: true, path: c, version: ver.text };
  }
  const found =
    tried.length === 0
      ? "No Node.js was found."
      : `Only an older Node.js was found: ${tried.join(", ")}.`;
  return {
    ok: false,
    tried,
    message: `${found} Install Node.js ${MIN_NODE_MAJOR} or newer (https://nodejs.org), then run the installer again.`,
  };
}
