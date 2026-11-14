// Tests of the server's safeguards (§4.5): the environment scrub (SRV-2, SRV-3), the outbound
// neutralisation (SRV-4) and the content-free log (SRV-5). The unit cases run in every tier; the
// cases that start the server run in the local and full tiers.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { McpHarness } from "@mosaic-distiller/mcp-harness";
import { buildToolResult, refusalResult } from "../src/app";
import {
  ContentFreeLog,
  LOG_FILE,
  dataDirectory,
  formatEvent,
  type LogEvent,
} from "../src/safeguards/log";
import { neutraliseOutbound } from "../src/safeguards/neutralise";
import { ALLOWED_ENVIRONMENT, scrubEnvironment } from "../src/safeguards/scrub";
import { DISTILL_DESCRIPTION } from "../src/tools";
import {
  canSpawn,
  carriesMarker,
  cleanTmp,
  detectsPaymentSignal,
  startBuilt,
  tmpDir,
} from "./helpers";

afterAll(cleanTmp);

const allowed = new Set(ALLOWED_ENVIRONMENT);

describe("SRV-2 scrubEnvironment", () => {
  it("SRV-2 keeps the allow-list and DISTILLER_*, deletes the rest", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/bin",
      HOME: "/h",
      LANG: "C",
      DISTILLER_ANYTHING: "1",
      OPENAI_API_KEY: "sk-test-not-real",
      AWS_SECRET_ACCESS_KEY: "not-real",
      MY_TOKEN: "x",
      NODE_OPTIONS: "--require x.js",
      NODE_PATH: "/x",
      http_proxy: "http://x",
    };
    const removed = scrubEnvironment(env, "linux");
    expect(Object.keys(env).sort()).toEqual(["DISTILLER_ANYTHING", "HOME", "LANG", "PATH"]);
    expect(removed).toBe(6);
  });
  it("SRV-2 an allowed name in another case is not allowed on Linux, and is on Windows", () => {
    const linux: NodeJS.ProcessEnv = { Path: "x", path: "y", PATH: "z" };
    scrubEnvironment(linux, "linux");
    expect(Object.keys(linux)).toEqual(["PATH"]);
    const win: NodeJS.ProcessEnv = {
      Path: "x",
      SYSTEMROOT: "y",
      Distiller_X: "1",
      OPENAI_API_KEY: "k",
    };
    scrubEnvironment(win, "win32");
    expect(Object.keys(win).sort()).toEqual(["Distiller_X", "Path", "SYSTEMROOT"]);
  });
  it("SRV-2 names that only start like an allowed name are deleted", () => {
    const env: NodeJS.ProcessEnv = {
      PATHEXT: "x",
      HOME2: "x",
      XDG_CONFIG_DIRS: "x",
      LC_MESSAGES: "x",
      DISTILLER: "x",
    };
    scrubEnvironment(env, "linux");
    expect(Object.keys(env)).toEqual([]);
  });
  it("SRV-2 for any set of names, only allowed names and DISTILLER_* survive", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 30 }),
        (names) => {
          const env: NodeJS.ProcessEnv = {};
          for (const n of names) if (!n.includes("=") && !n.includes("\0")) env[n] = "v";
          scrubEnvironment(env, "linux");
          for (const k of Object.keys(env))
            expect(allowed.has(k) || k.startsWith("DISTILLER_")).toBe(true);
        },
      ),
      { seed: 20261113, numRuns: 200 },
    );
  });
});

describe.skipIf(!canSpawn)("SRV-2 the running server", () => {
  it("SRV-2 reports only allow-listed names when the parent holds provider keys", async () => {
    const { harness } = await startBuilt("test-entry", {
      parentEnv: {
        OPENAI_API_KEY: "sk-test-not-real",
        AWS_SECRET_ACCESS_KEY: "not-real",
        MY_TOKEN: "not-real",
        ANTHROPIC_API_KEY: "not-real",
        DISTILLER_KEEP: "1",
      },
    });
    try {
      const names = JSON.parse(McpHarness.text(await harness.callTool("test_env"))) as string[];
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(allowed.has(n) || n.startsWith("DISTILLER_"), n).toBe(true);
      for (const gone of [
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "MY_TOKEN",
        "ANTHROPIC_API_KEY",
      ])
        expect(names).not.toContain(gone);
      expect(names).toContain("DISTILLER_KEEP");
      expect(names).toContain("PATH");
    } finally {
      await harness.close();
    }
  });
  it("SRV-2 the installed entry scrubs too: the same parent, the real server, still answers", async () => {
    const { harness } = await startBuilt("server", {
      parentEnv: { OPENAI_API_KEY: "sk-test-not-real" },
    });
    try {
      const r = await harness.callTool("distill", { text: "plain words" });
      expect(r.isError).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
});

describe.skipIf(!canSpawn)("SRV-3 NODE_OPTIONS never takes effect", () => {
  function marker(): { file: string; hook: string } {
    const dir = tmpDir("srv-marker-");
    const file = join(dir, "ran.txt");
    const hook = join(dir, "marker.cjs");
    writeFileSync(hook, `require("node:fs").writeFileSync(${JSON.stringify(file)}, "ran");\n`);
    return { file, hook };
  }
  it("SRV-3 with the installer's entry, the marker never runs", async () => {
    const m = marker();
    const { harness } = await startBuilt("server", {
      parentEnv: { NODE_OPTIONS: `--require ${m.hook}` },
    });
    try {
      const r = await harness.callTool("distill", { text: "hello" });
      expect(r.isError).toBeUndefined();
    } finally {
      await harness.close();
    }
    expect(existsSync(m.file)).toBe(false);
  });
  it("SRV-3 the same server started without the blanking does run the marker (the test can fail)", async () => {
    const m = marker();
    const { harness } = await startBuilt("server", {
      parentEnv: { NODE_OPTIONS: `--require ${m.hook}` },
      entryEnv: {},
    });
    try {
      await harness.callTool("capabilities");
    } finally {
      await harness.close();
    }
    expect(existsSync(m.file)).toBe(true);
  });
  it("SRV-3 NODE_PATH blanked in the entry is not set in the server", async () => {
    const { harness } = await startBuilt("test-entry", {
      parentEnv: { NODE_PATH: "/nonexistent" },
    });
    try {
      const names = JSON.parse(McpHarness.text(await harness.callTool("test_env"))) as string[];
      expect(names).not.toContain("NODE_PATH");
    } finally {
      await harness.close();
    }
  });
});

const FORMS = [
  "<use_tool",
  "<USE_TOOL",
  "<Use_Tool name='x'>",
  "<mosaic_ui",
  "<MOSAIC_UI>",
  '"__payment_required"',
  '{"__payment_required": true}',
  '\\"__payment_required\\"',
  "__PAYMENT_REQUIRED",
  "__payment_required",
  "\\u003cuse_tool",
  "<<use_tool",
  "<use_<use_tooltool",
];

describe("SRV-4 neutraliseOutbound", () => {
  it("SRV-4 replaces each marker with the fixed text, in any case", () => {
    expect(neutraliseOutbound("a <use_tool b")).toBe("a [neutralised: use_tool] b");
    expect(neutraliseOutbound("a <USE_TOOL b")).toBe("a [neutralised: use_tool] b");
    expect(neutraliseOutbound("<mosaic_ui>")).toBe("[neutralised: mosaic_ui]>");
    expect(neutraliseOutbound("x __payment_required y")).toBe(
      "x [neutralised: payment_required] y",
    );
  });
  it("SRV-4 keeps the quotes round the payment key, so that JSON stays valid and has no such key", () => {
    const out = neutraliseOutbound('{"__payment_required":true}');
    expect(out).toBe('{"[neutralised: payment_required]":true}');
    expect(() => JSON.parse(out)).not.toThrow();
    expect(detectsPaymentSignal(out)).toBe(false);
  });
  it("SRV-4 leaves text without a marker as it was", () => {
    for (const s of [
      "",
      "plain",
      "use_tool without the bracket",
      "mosaic ui",
      "payment required",
      "a < b",
    ])
      expect(neutraliseOutbound(s)).toBe(s);
  });
  it("SRV-4 for any text, no marker survives, the result is idempotent and a JSON text stays valid", () => {
    const piece = fc.oneof(
      fc.string({ maxLength: 8 }),
      fc.constantFrom(...FORMS),
      fc.constantFrom('"', "\\", "<", "_"),
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (parts) => {
        const s = parts.join("");
        const out = neutraliseOutbound(s);
        expect(carriesMarker(out)).toBe(false);
        expect(neutraliseOutbound(out)).toBe(out);
        const json = neutraliseOutbound(JSON.stringify({ s, k: [s] }));
        expect(() => JSON.parse(json)).not.toThrow();
        expect(carriesMarker(json)).toBe(false);
      }),
      { seed: 20261113, numRuns: 500 },
    );
  });
  it("SRV-4 buildToolResult, the one place a result is made, neutralises results and errors alike", () => {
    for (const isError of [false, true]) {
      const r = buildToolResult(`{"a":"<use_tool x __payment_required <mosaic_ui"}`, isError);
      const first = r.content[0];
      expect(first?.type).toBe("text");
      expect(carriesMarker(first?.type === "text" ? first.text : "")).toBe(false);
      expect(r.isError).toBe(isError ? true : undefined);
    }
    expect(refusalResult("INTERNAL").isError).toBe(true);
  });
  it("SRV-4 the tool descriptions carry no marker", () => {
    expect(carriesMarker(DISTILL_DESCRIPTION)).toBe(false);
  });
});

describe.skipIf(!canSpawn)("SRV-4 through the running server", () => {
  it("SRV-4 no result carries a marker, whichever argument, tool or error path holds it", async () => {
    const { harness } = await startBuilt("server");
    const seen: string[] = [];
    const record = (r: Awaited<ReturnType<McpHarness["callTool"]>>): void => {
      for (const c of r.content) if (c.type === "text") seen.push(c.text);
    };
    try {
      for (const f of FORMS) {
        record(await harness.callTool("distill", { text: `before ${f} after` }));
        record(await harness.callTool("distill", { text: f, profile: "document" }));
        record(
          await harness.callTool("distill", {
            segments: [
              { id: "__payment_required", text: `x ${f}`, kind: f },
              { id: "b", text: f },
            ],
          }),
        );
        record(
          await harness.callTool("distill", {
            text: `say ${f} and other`,
            dictionaries: [
              { name: "__payment_required", terms: [f, "other"], template: `${f} {n}` },
              { name: "use_tool", terms: ["say"] },
            ],
            objective: { kind: "task", task: f },
          }),
        );
        record(await harness.callTool("distill", { text: "t", profile: f }));
        record(await harness.callTool("distill", { text: "t", mode: f }));
        record(await harness.callTool("distill", { text: "t", [f]: 1 }));
        record(await harness.callTool("distill", { segments: [{ id: f, text: "t" }] }));
        record(await harness.callTool("capabilities", { [f]: f }));
        record(await harness.callTool(f, { text: f }));
      }
      // Split across segments: each half alone is harmless, and neither result joins them.
      record(
        await harness.callTool("distill", {
          segments: [
            { id: "1", text: "<use_" },
            { id: "2", text: "tool" },
            { id: "3", text: "__payment" },
            { id: "4", text: "_required" },
          ],
        }),
      );
    } finally {
      await harness.close();
    }
    expect(seen.length).toBeGreaterThan(100);
    for (const t of seen) {
      expect(carriesMarker(t), t.slice(0, 120)).toBe(false);
      expect(detectsPaymentSignal(t)).toBe(false);
    }
  });
});

describe("SRV-5 the log holds no content", () => {
  it("SRV-5 formatEvent writes only fixed codes and numbers", () => {
    expect(
      formatEvent({ code: "result", tool: "distill", outcome: "ok", ms: 3, bytes: 10 }, 5),
    ).toBe('{"ts":5,"code":"result","tool":"distill","outcome":"ok","ms":3,"bytes":10}\n');
    const bad: unknown[] = [
      { code: "zq9canary" },
      { code: "call", tool: "zq9canary" },
      { code: "result", outcome: "zq9canary" },
      { code: "call", segments: "zq9canary" },
      { code: "call", ms: Number.NaN },
      { code: "call", bytes: -1 },
    ];
    for (const ev of bad) expect(formatEvent(ev as LogEvent, 0)).toBeNull();
  });
  it("SRV-5 an extra field smuggled in at run time is not written", () => {
    const line = formatEvent({ code: "call", text: "zq9canary" } as unknown as LogEvent, 0);
    expect(line).not.toBeNull();
    expect(line).not.toContain("zq9canary");
  });
  it("SRV-5 an event type with a free-text field does not compile", () => {
    // @ts-expect-error a string that is not a fixed tool code is not a LogEvent
    const a: LogEvent = { code: "call", tool: "zq9canary" };
    // @ts-expect-error there is no free-text field
    const b: LogEvent = { code: "call", message: "zq9canary" };
    expect([a, b].length).toBe(2);
  });
  it("SRV-5 the log is created owner-only, rotates at its limit and keeps two files", () => {
    const dir = join(tmpDir("srv-log-"), "data");
    let t = 1;
    const log = new ContentFreeLog(dir, 400, () => t++);
    for (let i = 0; i < 60; i++) log.write({ code: "call", tool: "distill", segments: i });
    const names = readdirSync(dir).sort();
    expect(names).toEqual([LOG_FILE, `${LOG_FILE}.1`]);
    for (const n of names) expect(statSync(join(dir, n)).size).toBeLessThanOrEqual(400);
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o777).toBe(0o700);
    const last = readFileSync(join(dir, LOG_FILE), "utf8").trim().split("\n").pop();
    expect(JSON.parse(last as string).segments).toBe(59);
  });
  it("SRV-5 a log that cannot be written never throws", () => {
    const dir = tmpDir("srv-log-");
    mkdirSync(join(dir, LOG_FILE));
    const log = new ContentFreeLog(dir);
    expect(() => log.write({ code: "start" })).not.toThrow();
  });
  it("SRV-5 the data directory is the one of §4.6 for each system", () => {
    expect(dataDirectory({ XDG_DATA_HOME: "/x" }, "linux", "/h")).toBe("/x/ai-distiller");
    expect(dataDirectory({}, "linux", "/h")).toBe("/h/.local/share/ai-distiller");
    expect(dataDirectory({ XDG_DATA_HOME: "" }, "linux", "/h")).toBe(
      "/h/.local/share/ai-distiller",
    );
    expect(dataDirectory({}, "darwin", "/h")).toBe("/h/Library/Application Support/ai-distiller");
    expect(dataDirectory({ LOCALAPPDATA: "/L" }, "win32", "/h")).toBe("/L/ai-distiller");
  });
});

describe.skipIf(!canSpawn)("SRV-5 through the running server", () => {
  it("SRV-5 a canary in every argument of every call is in neither the log nor stderr", async () => {
    const canary = "zq9canaryxk3";
    const { harness, box } = await startBuilt("server");
    try {
      await harness.callTool("distill", { text: `${canary} jane.doe@northwind-mail.com` });
      await harness.callTool("distill", {
        segments: [{ id: canary, text: canary, kind: canary }],
        dictionaries: [{ name: canary, terms: [canary + canary], template: `${canary} {n}` }],
        objective: { kind: "task", task: canary },
        profile: canary,
        mode: canary,
      });
      await harness.callTool("distill", { [canary]: canary, text: canary });
      await harness.callTool("distill", { text: canary, profile: "document" });
      await harness.callTool("capabilities", { [canary]: canary });
      await harness.callTool(canary, { text: canary });
    } finally {
      await harness.close();
    }
    const files = readdirSync(box.dataDir);
    expect(files).toContain(LOG_FILE);
    const log = readFileSync(join(box.dataDir, LOG_FILE), "utf8");
    expect(log.trim().split("\n").length).toBeGreaterThanOrEqual(10);
    for (const f of files) expect(readFileSync(join(box.dataDir, f), "utf8")).not.toContain(canary);
    expect(harness.stderr).not.toContain(canary);
    expect(harness.stderr).toBe("");
  });
});
