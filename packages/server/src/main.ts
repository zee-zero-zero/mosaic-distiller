// Provides the installed server's entry (`dist/server.mjs`). Its first import scrubs the
// environment (§4.5). The same file is the engine worker: a worker thread starts the file again,
// and runs the worker code instead of the server.
import "./safeguards/scrub-first";
import { isMainThread } from "node:worker_threads";
import { startServer } from "./start";
import { runWorker } from "./worker";

if (isMainThread) {
  void startServer({ entryUrl: import.meta.url });
} else {
  runWorker();
}
