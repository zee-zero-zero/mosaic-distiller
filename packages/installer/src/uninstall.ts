// Provides `uninstall` (§6.3): removes the distiller's entry from MosAIc's `mcp-plugins.json`
// (every other entry stays byte for byte), removes the installed copy of the server, and removes
// the rest of the data directory only when the caller's `confirm` says yes.
import { existsSync, rmSync } from "node:fs";
import type { Outcome } from "./install";
import { dataDir, installDir, pluginsFile, type PathEnv } from "./paths";
import { applyEdit, realFsOps, type FsOps } from "./plugins-file";

export interface UninstallOptions {
  paths: PathEnv;
  /** True with `--yes`: the data directory is removed without asking. */
  yes: boolean;
  /** Asks the user a yes/no question; false when there is no answer. */
  confirm: (question: string) => Promise<boolean>;
  fsOps?: FsOps;
}

export async function uninstall(o: UninstallOptions): Promise<Outcome> {
  const lines: string[] = [];
  const file = pluginsFile(o.paths);
  const res = applyEdit(file, { kind: "remove" }, o.fsOps ?? realFsOps);
  if (!res.ok) return { exitCode: 1, lines: [res.message] };
  lines.push(
    res.changed
      ? `Removed the "distiller" entry from ${file} (backup: ${res.backup ?? "none"})`
      : `No "distiller" entry in ${file}`,
  );
  const server = installDir(o.paths);
  if (existsSync(server)) {
    rmSync(server, { recursive: true, force: true });
    lines.push(`Removed ${server}`);
  }
  const data = dataDir(o.paths);
  if (existsSync(data)) {
    const ok =
      o.yes || (await o.confirm(`Also remove the data directory ${data} (the log)? [y/N] `));
    if (ok) {
      rmSync(data, { recursive: true, force: true });
      lines.push(`Removed ${data}`);
    } else {
      lines.push(`Kept ${data}`);
    }
  }
  lines.push("Next: in MosAIc, press Refresh on the MCP page (or restart MosAIc).");
  return { exitCode: 0, lines };
}
