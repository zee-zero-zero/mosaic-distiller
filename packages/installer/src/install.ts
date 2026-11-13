// Provides `install` (§6.3): finds Node, copies the server into the per-user directory, and adds
// or replaces the distiller's entry in MosAIc's `mcp-plugins.json`. Returns an exit code and the
// lines to print; it prints nothing itself. Running it twice gives the same result as once.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { findNode, type FindNodeOptions } from "./node-finder";
import {
  dataDir,
  installDir,
  installedServerFile,
  mosaicDir,
  pluginsFile,
  type PathEnv,
} from "./paths";
import { applyEdit, makeEntry, realFsOps, type FsOps } from "./plugins-file";

export interface Outcome {
  exitCode: number;
  lines: string[];
}

export interface InstallOptions {
  paths: PathEnv;
  /** The directory holding `server.mjs`, `rulepacks/` and `profiles/` to copy from. */
  serverSource: string;
  node: Omit<FindNodeOptions, "platform" | "home" | "env">;
  fsOps?: FsOps;
}

/** The files the installed server needs, relative to its directory. */
export function missingServerFiles(dir: string): string[] {
  const need = ["server.mjs", join("rulepacks", "default.json")];
  const missing = need.filter((f) => !existsSync(join(dir, f)));
  const profiles = join(dir, "profiles");
  const hasProfile = existsSync(profiles) && readdirSync(profiles).some((n) => n.endsWith(".json"));
  if (!hasProfile) missing.push(join("profiles", "*.json"));
  return missing;
}

function copyServer(source: string, target: string): void {
  const stage = `${target}.new-${process.pid}`;
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(join(source, "server.mjs"), join(stage, "server.mjs"));
  cpSync(join(source, "rulepacks"), join(stage, "rulepacks"), { recursive: true });
  cpSync(join(source, "profiles"), join(stage, "profiles"), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(stage, target);
}

export function install(o: InstallOptions): Outcome {
  const lines: string[] = [];
  const fail = (m: string): Outcome => ({ exitCode: 1, lines: [...lines, m] });

  const found = findNode({
    ...o.node,
    platform: o.paths.platform,
    home: o.paths.home,
    env: o.paths.env,
  });
  if (!found.ok) return fail(found.message);
  lines.push(`Node.js ${found.version} found at ${found.path}`);

  const missing = missingServerFiles(o.serverSource);
  if (missing.length > 0) {
    return fail(
      `The installer's copy of the server is incomplete (missing: ${missing.join(", ")}). Run "npm run build" in the repository, then run the installer again.`,
    );
  }

  const settings = mosaicDir(o.paths);
  const file = pluginsFile(o.paths);
  const settingsExisted = existsSync(settings);
  const entry = makeEntry(found.path, installedServerFile(o.paths));

  // Check the plugins file first, so that a file we refuse to touch stops the install before
  // anything is copied.
  const dry = applyEdit(file, { kind: "upsert", entry }, realFsOps, true);
  if (!dry.ok) return fail(dry.message);

  mkdirSync(dataDir(o.paths), { recursive: true, mode: 0o700 });
  copyServer(o.serverSource, installDir(o.paths));
  lines.push(`Server copied to ${installDir(o.paths)}`);

  if (!settingsExisted) {
    mkdirSync(settings, { recursive: true });
    lines.push(`MosAIc has not been started yet: created its settings directory ${settings}`);
  }
  const res = applyEdit(file, { kind: "upsert", entry }, o.fsOps ?? realFsOps);
  if (!res.ok) return fail(res.message);
  if (res.changed) {
    lines.push(
      `${res.oursBefore > 0 ? "Updated" : "Added"} the "distiller" entry in ${file}` +
        (res.backup !== null ? ` (backup: ${res.backup})` : ""),
    );
  } else {
    lines.push(`The "distiller" entry in ${file} is already up to date`);
  }
  lines.push(
    'Next: in MosAIc, open the MCP page and press Refresh (or restart MosAIc). "distiller" then lists two tools, "distill" and "capabilities".',
  );
  return { exitCode: 0, lines };
}
