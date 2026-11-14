// Builds the installer: bundles packages/installer/src/cli.ts into packages/installer/dist/cli.mjs
// with esbuild (the MCP SDK inside), and copies the built server (server.mjs, rulepacks/,
// profiles/) from packages/server/dist into packages/installer/dist/server/, so that the installer
// carries the server it installs. Run after the server's build.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverDist = join(root, "packages/server/dist");
const out = join(root, "packages/installer/dist");

if (!existsSync(join(serverDist, "server.mjs"))) {
  console.error(
    "packages/server/dist/server.mjs is missing: build the server first (npm run build at the repository root).",
  );
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, "packages/installer/src/cli.ts")],
  outfile: join(out, "cli.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
});
mkdirSync(join(out, "server"), { recursive: true });
cpSync(join(serverDist, "server.mjs"), join(out, "server/server.mjs"));
cpSync(join(serverDist, "rulepacks"), join(out, "server/rulepacks"), { recursive: true });
cpSync(join(serverDist, "profiles"), join(out, "server/profiles"), { recursive: true });
console.log("installer built: packages/installer/dist/cli.mjs");
