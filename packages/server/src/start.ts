// Provides startServer, the start-up of §4.1 shared by the installed entry and the test entry, in
// order: load and verify the pack and profiles from the directory of the running file; start the
// engine worker; connect stdio. A refused pack writes `DISTILLER_START_FAILED <code>` to stderr
// and exits with status 2 before connecting. When stdin ends, the server exits within 2 seconds.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RulePackError, createEngine } from "@mosaic-distiller/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDistillerServer, type ExtraTool } from "./app";
import { loadAssets } from "./assets";
import { EnginePool, realClock, type Clock } from "./pool";
import { ContentFreeLog } from "./safeguards/log";

export interface StartOptions {
  /** `import.meta.url` of the running entry file. */
  entryUrl: string;
  clock?: Clock;
  extraTools?: (pool: EnginePool) => ExtraTool[];
}

/** The fixed start-up failure line (§4.1): the code, and nothing taken from anywhere else. */
export function startFailureLine(code: string): string {
  return `DISTILLER_START_FAILED ${/^[A-Z_]+$/.test(code) ? code : "INTERNAL"}\n`;
}

export async function startServer(options: StartOptions): Promise<void> {
  // Nothing may reach stdout except the protocol.
  for (const m of ["log", "info", "debug", "warn", "error", "trace"] as const) {
    console[m] = () => undefined;
  }
  const log = new ContentFreeLog();
  const entryFile = fileURLToPath(options.entryUrl);
  const dir = dirname(entryFile);

  let pool: EnginePool;
  let capabilitiesText: string;
  try {
    const assets = loadAssets(dir);
    capabilitiesText = JSON.stringify(createEngine(assets).capabilities());
    pool = new EnginePool(options.entryUrl, dir, options.clock ?? realClock, {
      onRestart: (reason) =>
        log.write({ code: reason === "deadline" ? "worker_restart" : "worker_error" }),
    });
    await pool.start();
  } catch (e) {
    process.stderr.write(startFailureLine(e instanceof RulePackError ? e.code : "INTERNAL"));
    process.exit(2);
  }

  const server = createDistillerServer({
    pool,
    capabilitiesText,
    log,
    extraTools: options.extraTools?.(pool) ?? [],
  });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    log.write({ code: "stop" });
    // Whatever is running, leave within two seconds.
    setTimeout(() => process.exit(0), 1500).unref();
    void pool.close().finally(() => process.exit(0));
  };
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  process.stdout.on("error", stop);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  await server.connect(new StdioServerTransport());
  log.write({ code: "start" });
}
