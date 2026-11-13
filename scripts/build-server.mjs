// Builds the server (§4.1, §6.3): bundles packages/server/src/main.ts into
// packages/server/dist/server.mjs, one file holding the engine, the server and the MCP SDK, and
// the test-only entry into dist/test-entry.mjs; copies rulepacks/default.json and profiles/ next
// to them. The bundle needs no node_modules. Run with no argument from any directory.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const dist = join(root, "packages/server/dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: {
    server: join(root, "packages/server/src/main.ts"),
    "test-entry": join(root, "packages/server/src/test-entry.ts"),
  },
  outdir: dist,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  logLevel: "warning",
  // Some dependencies of the SDK are CommonJS and call require().
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
cpSync(join(root, "rulepacks/default.json"), join(dist, "rulepacks/default.json"), {
  recursive: true,
});
cpSync(join(root, "profiles"), join(dist, "profiles"), { recursive: true });
console.log("built packages/server/dist");
