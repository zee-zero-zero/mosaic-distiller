// Provides loadAssets: reads the rule pack and the profiles from the directory the server was
// installed in (`rulepacks/default.json`, `profiles/*.json`), verifies them with the core loaders,
// and returns the engine's inputs. Any failure is a RulePackError whose code is a loader code,
// which start-up writes to stderr as the one fixed line of §4.1.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RulePackError,
  loadProfile,
  loadRulePack,
  type Profile,
  type RulePack,
} from "@mosaic-distiller/core";

export const DEFAULT_PROFILE = "agent";

export interface Assets {
  pack: RulePack;
  profiles: Profile[];
  defaultProfile: string;
}

function readJson(file: string, code: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new RulePackError(code, "a file cannot be read or is not JSON");
  }
}

export function loadAssets(dir: string): Assets {
  const pack = loadRulePack(readJson(join(dir, "rulepacks", "default.json"), "PACK_SCHEMA"));
  let names: string[];
  try {
    names = readdirSync(join(dir, "profiles")).filter((n) => n.endsWith(".json"));
  } catch {
    throw new RulePackError("PROFILE_SCHEMA", "the profiles directory cannot be read");
  }
  // Code-point order of the file names; the files are ASCII.
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const profiles = names.map((n) =>
    loadProfile(readJson(join(dir, "profiles", n), "PROFILE_SCHEMA"), pack),
  );
  if (!profiles.some((p) => p.name === DEFAULT_PROFILE)) {
    throw new RulePackError("PROFILE_SCHEMA", "the default profile is missing");
  }
  return { pack, profiles, defaultProfile: DEFAULT_PROFILE };
}
