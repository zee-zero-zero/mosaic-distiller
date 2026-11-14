// Tests that run what the installer wrote (INS-5) and the commands of the README (INS-7). Both
// start processes, so they run in the local and full tiers, after the global set-up has built the
// server and the installer.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpHarness } from "@mosaic-distiller/mcp-harness";
import { install } from "../src/install";
import { dataDir } from "../src/paths";
import { sandbox, spawnTier } from "./helpers";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER_DIST = join(ROOT, "packages/server/dist");

function entryOf(plugins: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
  name: string;
} {
  const list = JSON.parse(readFileSync(plugins, "utf8")) as { name: string }[];
  const ours = list.filter((e) => e.name === "distiller");
  expect(ours).toHaveLength(1);
  return ours[0] as never;
}

describe.skipIf(!spawnTier())("INS-5 the entry starts under MosAIc's conditions", () => {
  it("INS-5 with a minimal PATH like a Finder launch, the exact entry answers", async () => {
    const box = sandbox();
    const out = install({
      paths: box.paths,
      serverSource: SERVER_DIST,
      node: { execPath: process.execPath, pathEnv: process.env.PATH },
    });
    expect(out.exitCode, out.lines.join("\n")).toBe(0);
    const e = entryOf(box.plugins);
    expect(e.env).toEqual({ NODE_OPTIONS: "", NODE_PATH: "" });
    const h = await McpHarness.start(
      { command: e.command, args: e.args, env: e.env },
      {
        parentEnv: {
          PATH: "/usr/bin:/bin",
          HOME: box.paths.home,
          XDG_DATA_HOME: box.paths.env.XDG_DATA_HOME,
          // Junk that a naive server would act on.
          NODE_OPTIONS: "--require /nonexistent/never.js",
          NODE_PATH: "/nonexistent",
          OPENAI_API_KEY: "sk-test-not-real",
        },
      },
    );
    try {
      const tools = (await h.listTools()).map((t) => t.name).sort();
      expect(tools).toEqual(["capabilities", "distill"]);
      const r = await h.callTool("distill", { text: "Write to jane.doe@northwind-mail.com." });
      expect(McpHarness.text(r)).toContain("Write to person1@example.com.");
      expect(h.violations).toEqual([]);
    } finally {
      await h.close();
    }
  });
  it("INS-5 a data directory under a path with spaces works", async () => {
    const box = sandbox({ spaced: true });
    const out = install({
      paths: box.paths,
      serverSource: SERVER_DIST,
      node: { execPath: process.execPath, pathEnv: process.env.PATH },
    });
    expect(out.exitCode).toBe(0);
    const e = entryOf(box.plugins);
    expect(e.args[0]).toContain("dir with spaces");
    const h = await McpHarness.start(
      { command: e.command, args: e.args, env: e.env },
      {
        parentEnv: {
          PATH: "/usr/bin:/bin",
          HOME: box.paths.home,
          XDG_DATA_HOME: box.paths.env.XDG_DATA_HOME,
          LOCALAPPDATA: box.paths.env.LOCALAPPDATA,
        },
      },
    );
    try {
      expect((await h.listTools()).length).toBe(2);
    } finally {
      await h.close();
    }
  });
});

/** The commands of the README's fenced `sh` blocks that run the installer, in document order. */
function documentedCommands(): string[][] {
  // A Windows checkout may have converted the line endings.
  const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
  const section = readme.slice(
    readme.indexOf("## Install into MosAIc"),
    readme.indexOf("## What it does and does not do"),
  );
  const out: string[][] = [];
  for (const block of section.matchAll(/```sh\n([\s\S]*?)```/g)) {
    for (const line of (block[1] as string).split("\n")) {
      if (line.startsWith("node packages/installer/dist/cli.mjs ")) {
        out.push(line.split(" ").slice(1));
      }
    }
  }
  return out;
}

describe.skipIf(!spawnTier())("INS-7 the README's procedures work", () => {
  it("INS-7 install, doctor and uninstall, run exactly as documented in a temporary home", () => {
    const commands = documentedCommands();
    expect(commands.map((c) => c.slice(1).join(" "))).toEqual([
      "install",
      "doctor",
      "uninstall",
      "uninstall --yes",
    ]);
    const box = sandbox();
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      ...box.paths.env,
    } as Record<string, string>;
    const run = (c: string[]): { status: number | null; out: string } => {
      const r = spawnSync(process.execPath, [join(ROOT, c[0] as string), ...c.slice(1)], {
        cwd: ROOT,
        env,
        input: "",
        encoding: "utf8",
        timeout: 60_000,
      });
      return { status: r.status, out: r.stdout + r.stderr };
    };

    // install: `Added the "distiller" entry`, a copy of the server, an entry in the plugins file.
    let r = run(commands[0] as string[]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Added the "distiller" entry');
    expect(r.out).toContain("Refresh");
    expect(existsSync(join(dataDir(box.paths), "server", "server.mjs"))).toBe(true);
    expect(entryOf(box.plugins).name).toBe("distiller");

    // doctor: `all checks passed`.
    r = run(commands[1] as string[]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("all checks passed");

    // uninstall with no answer: the entry and the copy go, the data directory stays.
    r = run(commands[2] as string[]);
    expect(r.status, r.out).toBe(0);
    expect(JSON.parse(readFileSync(box.plugins, "utf8"))).toEqual([]);
    expect(existsSync(join(dataDir(box.paths), "server"))).toBe(false);
    expect(existsSync(dataDir(box.paths))).toBe(true);

    // uninstall --yes: the data directory goes too.
    r = run(commands[3] as string[]);
    expect(r.status, r.out).toBe(0);
    expect(existsSync(dataDir(box.paths))).toBe(false);
  });
  it("INS-7 the README states each outcome that the test checks", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const phrase of [
      'Added the "distiller" entry',
      "all checks passed",
      "press Refresh",
      "byte for byte",
      "keeps it",
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
  });
});
