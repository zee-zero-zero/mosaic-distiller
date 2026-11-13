// The installer's command line: `install`, `doctor`, `uninstall [--yes]` and `serve`. Exit codes:
// 0 done, 1 refused or a check failed, 2 wrong usage. `serve` runs the bundled server in this
// process, for the by-hand route of §6.3.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { doctor } from "./doctor";
import { install, type Outcome } from "./install";
import { realPathEnv } from "./paths";
import { uninstall } from "./uninstall";

const USAGE = `Usage: mosaic-distiller <command>

  install            copy the server and register it in MosAIc
  doctor             check the installation
  uninstall [--yes]  remove the entry and the installed copy; --yes also removes the data directory
  serve              run the server on stdio (for a hand-made MosAIc entry)
`;

/** The directory holding the bundled server: next to this file when bundled, else `dist/server`. */
function serverSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const beside = join(here, "server");
  return existsSync(join(beside, "server.mjs")) ? beside : join(here, "..", "dist", "server");
}

/** Reads a yes/no answer: from the terminal, or the first line of piped input; no input is no. */
async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin });
  const answer = await new Promise<string>((resolve) => {
    rl.once("line", (l) => resolve(l));
    rl.once("close", () => resolve(""));
  });
  rl.close();
  process.stdout.write("\n");
  return /^\s*y(es)?\s*$/i.test(answer);
}

function print(o: Outcome): number {
  for (const l of o.lines) console.log(l);
  return o.exitCode;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const paths = realPathEnv();
  if (cmd === "serve" && rest.length === 0) {
    await import(pathToFileURL(join(serverSource(), "server.mjs")).href);
    return -1;
  }
  if (cmd === "install" && rest.length === 0) {
    return print(
      install({
        paths,
        serverSource: serverSource(),
        node: { execPath: process.execPath, pathEnv: process.env.PATH },
      }),
    );
  }
  if (cmd === "doctor" && rest.length === 0) {
    return print(await doctor({ paths, parentEnv: process.env }));
  }
  if (cmd === "uninstall" && rest.every((a) => a === "--yes") && rest.length <= 1) {
    return print(await uninstall({ paths, yes: rest.length === 1, confirm }));
  }
  process.stderr.write(USAGE);
  return cmd === "--help" || cmd === "-h" ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`failed: ${e instanceof Error ? e.message : "unknown error"}`);
    process.exitCode = 1;
  },
);
