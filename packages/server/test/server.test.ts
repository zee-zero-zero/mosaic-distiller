// Tests of the server as a whole (§5.6): the tools over stdio (SRV-1), a strict stdout (SRV-6),
// argument validation (SRV-7), the deadline (SRV-8), concurrency and disconnection (SRV-9), a
// refused pack (SRV-10), the descriptions (SRV-11) and the same answer as the library (SRV-12).
// The cases that start the server run in the local and full tiers.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { McpHarness } from "@mosaic-distiller/mcp-harness";
import { REFUSAL_MESSAGES, serializeResult } from "@mosaic-distiller/core";
import { defaultEngine, isFullTier } from "../../core/test/helpers";
import { generatePool, requestFor } from "../../core/test/pool/generate";
import { DEADLINE_MS, EnginePool } from "../src/pool";
import {
  CAPABILITIES_DESCRIPTION,
  CAPABILITIES_SCHEMA,
  DISTILL_DESCRIPTION,
  DISTILL_SCHEMA,
  parseDistillArguments,
} from "../src/tools";
import { DIST, ROOT, canSpawn, cleanTmp, lonelyCopy, startBuilt, tmpDir } from "./helpers";
import { pathToFileURL } from "node:url";

afterAll(cleanTmp);

const text = (r: Awaited<ReturnType<McpHarness["callTool"]>>): string => McpHarness.text(r);
const json = (r: Awaited<ReturnType<McpHarness["callTool"]>>): any => JSON.parse(text(r));

describe("SRV-1 the tools over stdio", () => {
  it("SRV-1 parseDistillArguments turns text into segment 1 and passes the rest on", () => {
    expect(parseDistillArguments({ text: "a" })).toEqual({
      ok: true,
      request: { segments: [{ id: "1", text: "a" }] },
    });
    expect(
      parseDistillArguments({ segments: [{ id: "x", text: "a" }], profile: "document" }),
    ).toEqual({
      ok: true,
      request: { segments: [{ id: "x", text: "a" }], profile: "document" },
    });
  });
});

describe.skipIf(!canSpawn)("SRV-1 the running server", () => {
  for (const mode of ["strict", "sdk"] as const) {
    it(`SRV-1 lists both tools and calls them (${mode} client)`, async () => {
      const { harness } = await startBuilt("server", { mode });
      try {
        const tools = await harness.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(["capabilities", "distill"]);
        for (const t of tools) {
          expect((t.inputSchema as { additionalProperties?: boolean }).additionalProperties).toBe(
            false,
          );
        }
        const r = await harness.callTool("distill", {
          text: "Write to jane.doe@northwind-mail.com.",
        });
        expect(r.isError).toBeUndefined();
        expect(r.content).toHaveLength(1);
        expect(json(r).segments[0].distillate).toBe("Write to person1@example.com.");
        const c = json(await harness.callTool("capabilities"));
        expect(c.modes).toEqual(["rules"]);
        expect(c.profiles).toEqual({ names: ["agent", "document"], default: "agent" });
        expect(c.certified).toBe(false);
        expect(c.rulepack.name).toBe("default");
        expect(Object.keys(c.categories).length).toBeGreaterThan(50);
        expect(harness.violations).toEqual([]);
      } finally {
        await harness.close();
      }
    });
  }
  it("SRV-1 runs from a lone copy: server.mjs with its pack and profiles and no node_modules", async () => {
    const dir = lonelyCopy();
    expect(readdirSync(dir).sort()).toEqual(["profiles", "rulepacks", "server.mjs"]);
    const { harness } = await startBuilt("server", { dir });
    try {
      const r = await harness.callTool("distill", { text: "mail jane.doe@northwind-mail.com" });
      expect(json(r).segments[0].distillate).toBe("mail person1@example.com");
    } finally {
      await harness.close();
    }
  });
  it("SRV-1 the profile argument selects a profile and the default is agent", async () => {
    const { harness } = await startBuilt("server");
    try {
      const t = "server 10.20.30.40 up";
      const agent = json(await harness.callTool("distill", { text: t }));
      const doc = json(await harness.callTool("distill", { text: t, profile: "document" }));
      expect(agent.provenance.profile).toBe("agent");
      expect(doc.provenance.profile).toBe("document");
    } finally {
      await harness.close();
    }
  });
});

const NASTY = [
  "plain",
  "",
  "line separator and\r\nnewlines",
  "nul\u0000byte",
  "lone \ud800 surrogate",
  "zero​width e‍mail jane.doe@northwind-mail.com",
  "<use_tool name='x'> __payment_required",
  "emoji 😀 and 𝒳 beyond the plane",
  "\u0007bell \u001b[31mred\u001b[0m",
];

describe.skipIf(!canSpawn)("SRV-6 stdout carries only the protocol", () => {
  it("SRV-6 the pool and hostile strings through every tool leave no stray byte", async () => {
    const members = generatePool().filter((_, i) => i % (isFullTier() ? 1 : 5) === 0);
    const { harness } = await startBuilt("server");
    try {
      for (const m of members) await harness.callTool("distill", requestFor(m));
      for (const t of NASTY) {
        await harness.callTool("distill", { text: t });
        await harness.callTool("distill", { segments: [{ id: "a", text: t }] });
      }
      await harness.callTool("capabilities");
      await harness.callTool("distill", { bad: 1 });
      await harness.callTool("nonexistent", {});
      expect(harness.violations).toEqual([]);
      expect(harness.stdoutBytes.length).toBeGreaterThan(1000);
    } finally {
      await harness.close();
    }
    expect(harness.violations).toEqual([]);
  });
  it("SRV-6 a server that writes one stray line is caught by the strict reader", async () => {
    const dir = tmpDir("srv-noisy-");
    const file = join(dir, "noisy.mjs");
    writeFileSync(
      file,
      `process.stdout.write("debug: starting\\n");
       process.stdin.setEncoding("utf8");
       let buf = "";
       process.stdin.on("data", (d) => {
         buf += d;
         for (let i; (i = buf.indexOf("\\n")) >= 0; ) {
           const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
           if (m.method === "initialize")
             process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: "n", version: "1" } } }) + "\\n");
         }
       });`,
    );
    const h = await McpHarness.start(
      { command: process.execPath, args: [file] },
      { parentEnv: {} },
    );
    try {
      expect(h.violations.some((v) => v.includes("not JSON"))).toBe(true);
    } finally {
      await h.close();
    }
  });
  it("SRV-6 the strict reader flags a partial last line, a non-message and invalid UTF-8", async () => {
    const { StrictReader } = await import("@mosaic-distiller/mcp-harness");
    const r = new StrictReader(() => undefined);
    r.push(Buffer.from('{"a":1}\n'));
    r.push(Buffer.from([0xff, 0xfe, 0x0a]));
    r.push(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    r.push(Buffer.from('{"jsonrpc":"2.0"'));
    r.end();
    expect(r.violations).toHaveLength(3);
  });
});

describe.skipIf(!canSpawn)("SRV-7 argument validation", () => {
  const big = "a".repeat(10 * 1024 * 1024);
  const cases: [string, unknown, string][] = [
    ["a missing argument", undefined, "INVALID_ARGUMENTS"],
    ["{}", {}, "INVALID_ARGUMENTS"],
    ["a wrong type for text", { text: 5 }, "INVALID_ARGUMENTS"],
    ["null for text", { text: null }, "INVALID_ARGUMENTS"],
    ["a wrong type for segments", { segments: "abc" }, "INVALID_ARGUMENTS"],
    ["null for segments", { segments: null }, "INVALID_ARGUMENTS"],
    ["segments of wrong items", { segments: [1] }, "INVALID_ARGUMENTS"],
    ["a segment without an id", { segments: [{ text: "a" }] }, "INVALID_ARGUMENTS"],
    ["an unknown argument", { text: "a", txt: "b" }, "INVALID_ARGUMENTS"],
    [
      "an unknown argument in a segment",
      { segments: [{ id: "1", text: "a", extra: 1 }] },
      "INVALID_ARGUMENTS",
    ],
    [
      "both text and segments",
      { text: "a", segments: [{ id: "1", text: "a" }] },
      "INVALID_ARGUMENTS",
    ],
    ["neither text nor segments", { profile: "agent" }, "INVALID_ARGUMENTS"],
    ["null for profile", { text: "a", profile: null }, "INVALID_ARGUMENTS"],
    ["null for dictionaries", { text: "a", dictionaries: null }, "INVALID_ARGUMENTS"],
    [
      "a dictionary with a bad name",
      { text: "a", dictionaries: [{ name: "Bad Name", terms: ["xx"] }] },
      "INVALID_ARGUMENTS",
    ],
    [
      "a template without {n}",
      { text: "a", dictionaries: [{ name: "d", terms: ["xx"], template: "T" }] },
      "INVALID_ARGUMENTS",
    ],
    ["an objective of another kind", { text: "a", objective: { kind: "x" } }, "INVALID_ARGUMENTS"],
    ["a mode that does not exist", { text: "a", mode: "model" }, "UNSUPPORTED_MODE"],
    ["a profile that does not exist", { text: "a", profile: "strict" }, "UNKNOWN_PROFILE"],
    [
      "a duplicate segment id",
      {
        segments: [
          { id: "1", text: "a" },
          { id: "1", text: "b" },
        ],
      },
      "DUPLICATE_SEGMENT_ID",
    ],
    ["no segments", { segments: [] }, "EMPTY_INPUT"],
    [
      "a one-character term",
      { text: "a", dictionaries: [{ name: "d", terms: ["x"] }] },
      "TERM_TOO_SHORT",
    ],
    ["a 10 MB string", { text: big }, "INPUT_TOO_LARGE"],
  ];
  it("SRV-7 distill refuses each bad call with its code, and the server stays up", async () => {
    const { harness } = await startBuilt("server");
    try {
      for (const [label, args, code] of cases) {
        const r = await harness.callTool("distill", args);
        expect(r.isError, label).toBe(true);
        const body = json(r);
        expect(body.error.code, label).toBe(code);
        expect(body.error.message, label).toBe(
          REFUSAL_MESSAGES[code as keyof typeof REFUSAL_MESSAGES],
        );
        // The server still answers a good call.
        const ok = await harness.callTool("distill", { text: "still up" });
        expect(ok.isError, label).toBeUndefined();
      }
      expect(harness.violations).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("SRV-7 arguments that are not an object are refused at the protocol layer, and the server stays up", async () => {
    const { harness } = await startBuilt("server");
    try {
      for (const bad of [null, "text", 5, ["a"]]) {
        const outcome = await harness.callTool("distill", bad).then(
          (r) => (r.isError ? "error result" : "success"),
          () => "protocol error",
        );
        expect(outcome, JSON.stringify(bad)).not.toBe("success");
      }
      expect((await harness.callTool("distill", { text: "ok" })).isError).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
  it("SRV-7 capabilities ignores every argument", async () => {
    const { harness } = await startBuilt("server");
    try {
      const base = text(await harness.callTool("capabilities"));
      for (const args of [
        undefined,
        {},
        { x: 1 },
        { text: null },
        { segments: "x" },
        { text: big },
      ]) {
        const r = await harness.callTool("capabilities", args);
        expect(r.isError, JSON.stringify(args)?.slice(0, 40)).toBeUndefined();
        expect(text(r)).toBe(base);
      }
    } finally {
      await harness.close();
    }
  });
  it("SRV-7 an unknown tool is refused with a fixed message", async () => {
    const { harness } = await startBuilt("server");
    try {
      const r = await harness.callTool("rm_rf", { text: "x" });
      expect(r.isError).toBe(true);
      expect(json(r).error.code).toBe("INVALID_ARGUMENTS");
    } finally {
      await harness.close();
    }
  });
});

describe.skipIf(!canSpawn)("SRV-8 the deadline", () => {
  const waitPending = async (h: McpHarness, n: number): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      const p = json(await h.callTool("test_advance", { ms: 0 })).pending as number;
      if (p >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the call was never taken");
  };
  it("SRV-8 a handler that hangs gets DEADLINE at 20 seconds on a fake clock, and the next call answers", async () => {
    const { harness } = await startBuilt("test-entry", {
      parentEnv: { DISTILLER_TEST_FAKE_CLOCK: "1" },
    });
    try {
      const hung = harness.callTool("test_hang", {}, 5_000);
      await waitPending(harness, 1);
      // Just short of the deadline: nothing yet.
      await harness.callTool("test_advance", { ms: DEADLINE_MS - 1 });
      const early = await Promise.race([
        hung.then(() => "answered"),
        new Promise((r) => setTimeout(() => r("waiting"), 300)),
      ]);
      expect(early).toBe("waiting");
      await harness.callTool("test_advance", { ms: 1 });
      const r = await hung;
      expect(r.isError).toBe(true);
      expect(json(r).error.code).toBe("DEADLINE");
      const next = await harness.callTool(
        "distill",
        { text: "after the deadline jane.doe@northwind-mail.com" },
        10_000,
      );
      expect(json(next).segments[0].distillate).toBe("after the deadline person1@example.com");
    } finally {
      await harness.close();
    }
  });
  it("SRV-8 a call that waits behind a hung one is run on the new worker, not lost", async () => {
    const { harness } = await startBuilt("test-entry", {
      parentEnv: { DISTILLER_TEST_FAKE_CLOCK: "1" },
    });
    try {
      const hung = harness.callTool("test_hang", {}, 5_000);
      await waitPending(harness, 1);
      await harness.callTool("test_advance", { ms: 10_000 });
      const queued = harness.callTool(
        "distill",
        { text: "queued jane.doe@northwind-mail.com" },
        10_000,
      );
      await waitPending(harness, 2);
      await harness.callTool("test_advance", { ms: 10_000 });
      expect(json(await hung).error.code).toBe("DEADLINE");
      expect(json(await queued).segments[0].distillate).toBe("queued person1@example.com");
    } finally {
      await harness.close();
    }
  });
  it("SRV-8 a call still waiting at its own deadline is answered DEADLINE without stopping the worker", async () => {
    const { harness } = await startBuilt("test-entry", {
      parentEnv: { DISTILLER_TEST_FAKE_CLOCK: "1" },
    });
    try {
      const hung = harness.callTool("test_hang", {}, 5_000);
      await waitPending(harness, 1);
      const queued = harness.callTool("distill", { text: "x" }, 5_000);
      await waitPending(harness, 2);
      await harness.callTool("test_advance", { ms: DEADLINE_MS });
      expect(json(await hung).error.code).toBe("DEADLINE");
      expect(json(await queued).error.code).toBe("DEADLINE");
      expect((await harness.callTool("distill", { text: "fine" }, 5_000)).isError).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
  it("SRV-8 the pool's deadline is 20 seconds, and on the real clock a hung worker is replaced", async () => {
    expect(DEADLINE_MS).toBe(20_000);
    const file = pathToFileURL(join(DIST, "test-entry.mjs")).href;
    // Only the hung call gets the short deadline: the call after it runs on a replacement worker
    // that must start and load the engine first, which on a slow machine takes longer than 300 ms.
    let timers = 0;
    const fast = {
      setTimeout: (f: () => void) => {
        const h = setTimeout(f, timers++ === 0 ? 300 : DEADLINE_MS);
        return h;
      },
      clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    };
    const pool = new EnginePool(file, DIST, fast);
    await pool.start();
    try {
      const a = await Promise.race([
        pool.call({ kind: "hang" }),
        new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
      ]);
      expect(a?.outcome).toBe("deadline");
      const b = await pool.call({
        kind: "distill",
        request: { segments: [{ id: "1", text: "hi" }] } as never,
      });
      expect(b.outcome).toBe("ok");
    } finally {
      await pool.close();
    }
  });
});

describe.skipIf(!canSpawn)("SRV-9 concurrent calls and a disconnect", () => {
  it("SRV-9 20 concurrent calls each get the answer to their own request", async () => {
    const { harness } = await startBuilt("server");
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          harness.callTool("distill", {
            segments: [
              {
                id: `req-${i}`,
                text: `tag${i} jane.doe${i}@northwind-mail.com ${"filler ".repeat(i * 50)}`,
              },
            ],
          }),
        ),
      );
      results.forEach((r, i) => {
        const body = json(r);
        expect(body.segments[0].id).toBe(`req-${i}`);
        expect(body.segments[0].distillate.startsWith(`tag${i} person1@example.com`)).toBe(true);
      });
      expect(harness.violations).toEqual([]);
    } finally {
      await harness.close();
    }
  });
  it("SRV-9 mixed concurrent calls, good and bad, are each answered once", async () => {
    const { harness } = await startBuilt("server");
    try {
      const calls = Array.from({ length: 20 }, (_, i) =>
        i % 3 === 0
          ? harness.callTool("distill", { nope: i }).then((r) => ["bad", i, r.isError] as const)
          : i % 3 === 1
            ? harness.callTool("capabilities").then((r) => ["cap", i, r.isError] as const)
            : harness
                .callTool("distill", { segments: [{ id: `s${i}`, text: "x y" }] })
                .then((r) => ["ok", i, json(r).segments[0].id] as const),
      );
      for (const [kind, i, v] of await Promise.all(calls)) {
        if (kind === "bad") expect(v).toBe(true);
        if (kind === "cap") expect(v).toBeUndefined();
        if (kind === "ok") expect(v).toBe(`s${i}`);
      }
    } finally {
      await harness.close();
    }
  });
  it("SRV-9 when the client dies mid-call the server exits within 2 seconds", async () => {
    const { harness } = await startBuilt("test-entry");
    const pending = harness.callTool("test_hang", {}, 30_000).catch(() => "closed");
    await new Promise((r) => setTimeout(r, 400));
    const start = Date.now();
    harness.killClient();
    const exit = await Promise.race([
      harness.exited,
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    const took = Date.now() - start;
    if (exit === null) harness.kill();
    expect(exit, "the server did not exit").not.toBeNull();
    expect(took).toBeLessThan(2000);
    await pending;
  });
  it("SRV-9 when stdin simply ends, the server exits within 2 seconds", async () => {
    const { harness } = await startBuilt("server");
    await harness.callTool("capabilities");
    const start = Date.now();
    await harness.client.close();
    const exit = await Promise.race([
      harness.exited,
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    expect(exit).not.toBeNull();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe.skipIf(!canSpawn)("SRV-10 a refused rule pack", () => {
  function broken(edit: (dir: string) => void): {
    code: number | null;
    stdout: string;
    stderr: string;
  } {
    const dir = lonelyCopy();
    edit(dir);
    const r = spawnSync(process.execPath, [join(dir, "server.mjs")], {
      input: "",
      encoding: "utf8",
      timeout: 20_000,
      env: { PATH: process.env.PATH ?? "", HOME: dir, XDG_DATA_HOME: join(dir, "data") },
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  const pack = (dir: string): string => join(dir, "rulepacks", "default.json");
  const editPack = (f: (j: any) => void) => (dir: string) => {
    const j = JSON.parse(readFileSync(pack(dir), "utf8"));
    f(j);
    writeFileSync(pack(dir), JSON.stringify(j));
  };
  const cases: [string, (dir: string) => void, string][] = [
    ["a pack that is not JSON", (d) => writeFileSync(pack(d), "{ not json"), "PACK_SCHEMA"],
    ["a missing pack", (d) => rmSync(pack(d)), "PACK_SCHEMA"],
    ["an unknown format", editPack((j) => (j.format = "rulepack/9")), "PACK_FORMAT"],
    ["a pack without rules", editPack((j) => (j.rules = [])), "PACK_NO_RULES"],
    [
      "an unknown validator",
      editPack((j) => (j.rules[0].validators = ["no_such_validator"])),
      "PACK_UNKNOWN_VALIDATOR",
    ],
    [
      "a pattern outside the subset",
      editPack((j) => (j.rules[0].pattern = "(a)\\1")),
      "PACK_PATTERN_SUBSET",
    ],
    [
      "a missing profiles directory",
      (d) => rmSync(join(d, "profiles"), { recursive: true }),
      "PROFILE_SCHEMA",
    ],
    [
      "a profile with an unknown action",
      (d) => {
        const f = join(d, "profiles", "agent.json");
        const j = JSON.parse(readFileSync(f, "utf8"));
        j.actions["contact.email"] = "explode";
        writeFileSync(f, JSON.stringify(j));
      },
      "PROFILE_UNKNOWN_ACTION",
    ],
    ["no agent profile", (d) => rmSync(join(d, "profiles", "agent.json")), "PROFILE_SCHEMA"],
  ];
  for (const [label, edit, code] of cases) {
    it(`SRV-10 ${label}: exit 2 before connecting, only ${code} on stderr`, () => {
      const r = broken(edit);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe(`DISTILLER_START_FAILED ${code}\n`);
    });
  }
  it("SRV-10 the untouched copy starts (the control)", async () => {
    const dir = lonelyCopy();
    const { harness } = await startBuilt("server", { dir });
    try {
      expect((await harness.listTools()).length).toBe(2);
    } finally {
      await harness.close();
    }
  });
});

describe("SRV-11 the descriptions follow §4.4", () => {
  const spec = readFileSync(join(ROOT, "docs/spec/04-mcp-server.md"), "utf8");
  /** The blockquote that follows a `**Description**` marker in the specification, as one line. */
  const quoted = (after: string): string => {
    const lines = spec.slice(spec.indexOf(after)).split("\n").slice(1);
    const out: string[] = [];
    for (const l of lines) {
      if (l.startsWith(">")) out.push(l.slice(1).trim());
      else if (out.length > 0) break;
    }
    return out.join(" ");
  };
  const tools = [
    [
      "distill",
      DISTILL_DESCRIPTION,
      DISTILL_SCHEMA,
      quoted("**Description** (what every chat agent"),
    ],
    [
      "capabilities",
      CAPABILITIES_DESCRIPTION,
      CAPABILITIES_SCHEMA,
      quoted("**Description** (152 characters)"),
    ],
  ] as const;
  for (const [name, description, schema, fromSpec] of tools) {
    it(`SRV-11 ${name}: the exact text of the specification, at most 600 characters`, () => {
      expect(description).toBe(fromSpec);
      expect(description.length).toBeLessThanOrEqual(600);
      expect(description.length).toBe(name === "distill" ? 535 : 152);
    });
    it(`SRV-11 ${name}: no forbidden word except to deny it, no name behind the work`, () => {
      const sentences = description.split(/(?<=[.;:])\s+/);
      for (const s of sentences) {
        if (/\b(anonymi[sz]e[sd]?|anonymi[sz]ation|anonymous|isolated|isolation)\b/i.test(s)) {
          expect(/\bnot\b|\bno\b|\bnever\b/i.test(s), s).toBe(true);
        }
      }
      expect(description).not.toMatch(/mosaic|hypercycle/i);
    });
    it(`SRV-11 ${name}: every argument named in backticks exists in the schema`, () => {
      const props = Object.keys((schema as { properties: object }).properties);
      for (const m of description.matchAll(/`([a-z_]+)`/g)) {
        expect(props, m[1]).toContain(m[1]);
      }
    });
  }
  it("SRV-11 the schema of distill names exactly the arguments of §4.2, and forbids others", () => {
    expect(Object.keys(DISTILL_SCHEMA.properties).sort()).toEqual([
      "dictionaries",
      "mode",
      "objective",
      "profile",
      "segments",
      "text",
    ]);
    expect(DISTILL_SCHEMA.additionalProperties).toBe(false);
    expect(CAPABILITIES_SCHEMA.additionalProperties).toBe(false);
  });
  it("SRV-11 an example in a description validates against the schema", () => {
    // The only example is the fake `person1@example.com`, a value and not an argument; the
    // arguments the description names must be accepted by the server's own check.
    expect(
      parseDistillArguments({ text: "t", dictionaries: [{ name: "n", terms: ["xx"] }] }).ok,
    ).toBe(true);
  });
});

describe.skipIf(!canSpawn)("SRV-11 the running server lists the same descriptions", () => {
  it("SRV-11 tools/list returns the description and schema constants", async () => {
    const { harness } = await startBuilt("server");
    try {
      const tools = await harness.listTools();
      const by = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(by.distill?.description).toBe(DISTILL_DESCRIPTION);
      expect(by.capabilities?.description).toBe(CAPABILITIES_DESCRIPTION);
      expect(by.distill?.inputSchema).toEqual(JSON.parse(JSON.stringify(DISTILL_SCHEMA)));
    } finally {
      await harness.close();
    }
  });
});

describe.skipIf(!canSpawn)("SRV-12 the same answer as the library", () => {
  it("SRV-12 the pool through distill and through packages/core gives identical bytes", async () => {
    const members = generatePool().filter((_, i) => i % (isFullTier() ? 1 : 5) === 0);
    const engine = defaultEngine("agent");
    const { harness } = await startBuilt("server");
    try {
      for (const m of members) {
        const req = requestFor(m);
        const viaServer = text(await harness.callTool("distill", req));
        expect(viaServer, m.id).toBe(serializeResult(engine.distill(req)));
      }
      const doc = defaultEngine("document");
      for (const m of members.slice(0, 20)) {
        const req = { ...requestFor(m), profile: "document" };
        expect(text(await harness.callTool("distill", req)), m.id).toBe(
          serializeResult(doc.distill(req)),
        );
      }
    } finally {
      await harness.close();
    }
  });
  it("SRV-12 the text form equals one segment with id 1", async () => {
    const engine = defaultEngine("agent");
    const { harness } = await startBuilt("server");
    try {
      const t = "Mail jane.doe@northwind-mail.com or call (202) 456-1111.";
      expect(text(await harness.callTool("distill", { text: t }))).toBe(
        serializeResult(engine.distill({ segments: [{ id: "1", text: t }] })),
      );
    } finally {
      await harness.close();
    }
  });
});
