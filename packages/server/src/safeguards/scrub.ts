// Provides scrubEnvironment (§4.5): deletes every environment variable that is not on the
// allow-list and not one of our own `DISTILLER_*`, so that the server, and the worker it starts,
// never hold the provider keys that MosAIc passes to every server it starts.

/** The variables that survive the scrub, besides `DISTILLER_*` (§4.5). */
export const ALLOWED_ENVIRONMENT: readonly string[] = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
];

/**
 * Deletes every variable of `env` that is not allowed and returns how many were deleted. Windows
 * compares names without regard to case, as the system does.
 */
export function scrubEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): number {
  const fold = (name: string): string => (platform === "win32" ? name.toUpperCase() : name);
  const allowed = new Set(ALLOWED_ENVIRONMENT.map(fold));
  let removed = 0;
  for (const name of Object.keys(env)) {
    if (allowed.has(fold(name)) || fold(name).startsWith("DISTILLER_")) continue;
    delete env[name];
    removed++;
  }
  return removed;
}
