// Provides the directories the installer works in, per operating system (§4.6, §6.1, §6.3): the
// distiller's data directory, the installed copy of the server inside it, and MosAIc's settings
// directory with its `mcp-plugins.json`. Every function takes the platform, the environment and
// the home directory as arguments, so that tests point them at temporary directories.
import { homedir } from "node:os";
import { join } from "node:path";
import { PACKAGE_NAME } from "@mosaic-distiller/core";

export interface PathEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** The running machine's platform, environment and home directory. */
export function realPathEnv(): PathEnv {
  return { platform: process.platform, env: process.env, home: homedir() };
}

function nonEmpty(v: string | undefined): string | undefined {
  return v !== undefined && v !== "" ? v : undefined;
}

/** The distiller's own data directory: its log, and the installed copy of the server (§4.6). */
export function dataDir(p: PathEnv): string {
  if (p.platform === "darwin") return join(p.home, "Library", "Application Support", PACKAGE_NAME);
  if (p.platform === "win32") {
    return join(nonEmpty(p.env.LOCALAPPDATA) ?? join(p.home, "AppData", "Local"), PACKAGE_NAME);
  }
  return join(nonEmpty(p.env.XDG_DATA_HOME) ?? join(p.home, ".local", "share"), PACKAGE_NAME);
}

/** The directory holding the installed copy of the server (§6.3). */
export function installDir(p: PathEnv): string {
  return join(dataDir(p), "server");
}

/** The installed server's entry file. */
export function installedServerFile(p: PathEnv): string {
  return join(installDir(p), "server.mjs");
}

/** MosAIc's settings directory (§6.1). */
export function mosaicDir(p: PathEnv): string {
  if (p.platform === "darwin") {
    return join(p.home, "Library", "Application Support", "mosaic-companion");
  }
  if (p.platform === "win32") {
    return join(nonEmpty(p.env.APPDATA) ?? join(p.home, "AppData", "Roaming"), "mosaic-companion");
  }
  return join(nonEmpty(p.env.XDG_CONFIG_HOME) ?? join(p.home, ".config"), "mosaic-companion");
}

/** The file in which MosAIc keeps its MCP servers. */
export function pluginsFile(p: PathEnv): string {
  return join(mosaicDir(p), "mcp-plugins.json");
}
