// Provides the engine worker (§4.5, "A deadline per call"): the code that runs inside a
// `worker_threads` worker, loads the pack and profiles itself, and answers each message with the
// serialised result of one request. The engine is synchronous, so a call that never ends can only
// be stopped by terminating the whole worker, which the pool does at the deadline.
import { parentPort, workerData } from "node:worker_threads";
import { createEngine, serializeResult } from "@mosaic-distiller/core";
import type { DistillRequest } from "@mosaic-distiller/core";
import { loadAssets } from "./assets";

/** What the pool sends to the worker. */
export type WorkerJob =
  { id: number; kind: "distill"; request: DistillRequest } | { id: number; kind: string };
/** What the worker answers. `refused` is true when the text holds a refusal. */
export interface WorkerAnswer {
  id: number;
  text: string;
  refused: boolean;
}

/** Handlers for message kinds other than `distill`; only a test entry adds any. */
export type WorkerHooks = Record<string, (job: WorkerJob) => WorkerAnswer>;

export function runWorker(hooks: WorkerHooks = {}): void {
  const port = parentPort;
  if (port === null) return;
  const { dir } = workerData as { dir: string };
  const assets = loadAssets(dir);
  const engine = createEngine(assets);
  port.on("message", (job: WorkerJob) => {
    if (job.kind === "distill") {
      const result = engine.distill((job as { request: DistillRequest }).request);
      port.postMessage({
        id: job.id,
        text: serializeResult(result),
        refused: "error" in result,
      } satisfies WorkerAnswer);
      return;
    }
    const hook = hooks[job.kind];
    if (hook !== undefined) port.postMessage(hook(job));
  });
  port.postMessage({ id: 0, text: "ready", refused: false } satisfies WorkerAnswer);
}
