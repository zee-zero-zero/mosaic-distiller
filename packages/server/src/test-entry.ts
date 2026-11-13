// Provides the test-only server entry (`dist/test-entry.mjs`, §5.6): the installed server plus the
// hooks that SRV-2 and SRV-8 need. `test_env` reports the names of the environment variables the
// server sees; `test_hang` is a call whose worker never answers; `test_advance` moves a fake clock
// that the deadline runs on, and `test_pending` counts the calls the pool holds. The installer
// never copies this file.
import "./safeguards/scrub-first";
import { isMainThread } from "node:worker_threads";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { buildToolResult, type ExtraTool } from "./app";
import { DEADLINE_MS, type Clock, type EnginePool } from "./pool";
import { startServer } from "./start";
import { runWorker } from "./worker";

class FakeClock implements Clock {
  private now = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.timers]) {
      if (t.at <= this.now && this.timers.delete(id)) t.fn();
    }
  }
}

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as Tool["inputSchema"];

if (isMainThread) {
  const fake = process.env.DISTILLER_TEST_FAKE_CLOCK === "1" ? new FakeClock() : undefined;
  void startServer({
    entryUrl: import.meta.url,
    ...(fake !== undefined ? { clock: fake } : {}),
    extraTools: (pool: EnginePool): ExtraTool[] => [
      {
        tool: { name: "test_env", description: "Test only.", inputSchema: emptySchema },
        call: async () => buildToolResult(JSON.stringify(Object.keys(process.env).sort()), false),
      },
      {
        tool: { name: "test_hang", description: "Test only.", inputSchema: emptySchema },
        call: async () => {
          const a = await pool.call({ kind: "hang" });
          return buildToolResult(a.text, a.refused);
        },
      },
      {
        tool: { name: "test_advance", description: "Test only.", inputSchema: emptySchema },
        call: async (args) => {
          const ms = Number((args as { ms?: unknown } | undefined)?.ms ?? DEADLINE_MS);
          fake?.advance(ms);
          return buildToolResult(JSON.stringify({ pending: pool.pending }), false);
        },
      },
      {
        tool: { name: "test_pending", description: "Test only.", inputSchema: emptySchema },
        call: async () => buildToolResult(JSON.stringify({ pending: pool.pending }), false),
      },
    ],
  });
} else {
  runWorker({
    hang: () => {
      for (;;) {
        // A handler that never answers.
      }
    },
  });
}
