// Provides EnginePool (§4.5, "A deadline per call"): one engine worker, a queue in front of it,
// and a deadline of 20 seconds per call on a replaceable clock. A call that is running when its
// deadline passes costs the worker: the pool terminates it, starts a new one and answers DEADLINE;
// calls waiting behind it are sent to the new worker. A call still waiting at its deadline is
// answered DEADLINE and removed. Each call is matched to its own answer by an id.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { refusal, serializeResult } from "@mosaic-distiller/core";
import type { DistillRequest } from "@mosaic-distiller/core";
import type { WorkerAnswer } from "./worker";

export const DEADLINE_MS = 20_000;

/** The clock the deadline runs on; a test entry replaces it with a fake one. */
export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const realClock: Clock = {
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export type PoolOutcome = "ok" | "refused" | "deadline" | "internal";
export interface PoolAnswer {
  text: string;
  refused: boolean;
  outcome: PoolOutcome;
}
export interface PoolEvents {
  onRestart?: (reason: "deadline" | "crash") => void;
}

type Message = { kind: "distill"; request: DistillRequest } | { kind: string };

interface Job {
  id: number;
  message: Message;
  resolve: (a: PoolAnswer) => void;
  timer: unknown;
}

const deadlineAnswer = (): PoolAnswer => ({
  text: serializeResult(refusal("DEADLINE")),
  refused: true,
  outcome: "deadline",
});
const internalAnswer = (): PoolAnswer => ({
  text: serializeResult(refusal("INTERNAL")),
  refused: true,
  outcome: "internal",
});

export class EnginePool {
  private worker: Worker | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private nextId = 1;
  private closed = false;
  private pendingTimers = 0;
  private spawning = false;

  constructor(
    private readonly workerFile: string,
    private readonly dir: string,
    private readonly clock: Clock = realClock,
    private readonly events: PoolEvents = {},
  ) {}

  /** Calls waiting or running, for tests that need to know a call has been taken. */
  get pending(): number {
    return this.pendingTimers;
  }

  /** Starts the first worker and waits until it has loaded the pack. */
  start(): Promise<void> {
    return this.spawn();
  }

  call(message: Message): Promise<PoolAnswer> {
    return new Promise<PoolAnswer>((resolve) => {
      if (this.closed) {
        resolve(internalAnswer());
        return;
      }
      const job: Job = { id: this.nextId++, message, resolve, timer: undefined };
      this.pendingTimers++;
      job.timer = this.clock.setTimeout(() => this.expire(job), DEADLINE_MS);
      this.queue.push(job);
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const w = this.worker;
    this.worker = null;
    for (const job of [this.current, ...this.queue]) {
      if (job !== null) this.finish(job, internalAnswer());
    }
    this.current = null;
    this.queue = [];
    if (w !== null) await w.terminate();
  }

  private spawn(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const w = new Worker(fileURLToPath(this.workerFile), { workerData: { dir: this.dir } });
      let ready = false;
      w.on("message", (a: WorkerAnswer) => {
        if (!ready && a.id === 0) {
          ready = true;
          resolve();
          return;
        }
        this.answered(w, a);
      });
      w.on("error", () => {
        if (!ready) {
          ready = true;
          reject(new Error("worker failed to start"));
          return;
        }
        this.crashed(w);
      });
      w.on("exit", () => {
        if (!ready) {
          ready = true;
          reject(new Error("worker exited"));
          return;
        }
        this.crashed(w);
      });
      this.worker = w;
    });
  }

  private pump(): void {
    if (this.closed || this.current !== null) return;
    if (this.worker === null) {
      // The last replacement failed; try again now that a call is waiting.
      if (!this.spawning && this.queue.length > 0) void this.replace();
      return;
    }
    const job = this.queue.shift();
    if (job === undefined) return;
    this.current = job;
    this.worker.postMessage({ id: job.id, ...job.message });
  }

  private finish(job: Job, answer: PoolAnswer): void {
    this.clock.clearTimeout(job.timer);
    this.pendingTimers--;
    job.resolve(answer);
  }

  private answered(w: Worker, a: WorkerAnswer): void {
    if (w !== this.worker || this.current === null || this.current.id !== a.id) return;
    const job = this.current;
    this.current = null;
    this.finish(job, { text: a.text, refused: a.refused, outcome: a.refused ? "refused" : "ok" });
    this.pump();
  }

  /** The worker died on its own (out of memory, a bug): fail the running call, start afresh. */
  private crashed(w: Worker): void {
    if (w !== this.worker || this.closed) return;
    this.worker = null;
    const job = this.current;
    this.current = null;
    if (job !== null) this.finish(job, internalAnswer());
    this.events.onRestart?.("crash");
    void this.replace();
  }

  private expire(job: Job): void {
    if (job === this.current) {
      const old = this.worker;
      this.worker = null;
      this.current = null;
      this.finish(job, deadlineAnswer());
      this.events.onRestart?.("deadline");
      void old?.terminate();
      void this.replace();
      return;
    }
    const at = this.queue.indexOf(job);
    if (at < 0) return;
    this.queue.splice(at, 1);
    this.finish(job, deadlineAnswer());
  }

  private async replace(): Promise<void> {
    if (this.spawning) return;
    this.spawning = true;
    try {
      await this.spawn();
    } catch {
      // No worker: every queued call will reach its deadline and be answered.
      return;
    } finally {
      this.spawning = false;
    }
    if (this.closed) return;
    this.pump();
  }
}
