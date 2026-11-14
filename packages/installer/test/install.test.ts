// Tests of `install` and `uninstall` as a whole: INS-1 and INS-2 through the install command,
// INS-3 through its rename, and INS-6 (uninstall removes ours, and only ours).
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { install } from "../src/install";
import { dataDir, installDir, installedServerFile } from "../src/paths";
import { ENTRY_ID } from "../src/plugins-file";
import { uninstall } from "../src/uninstall";
import { fakeServerSource, otherSlices, oursCount, sandbox, tmp, write } from "./helpers";

const goodNode = { execPath: process.execPath, pathEnv: undefined };
const other = '{"id":"o","name":"other","transport":"stdio","command":"c","args":[]}';

function run(sb: ReturnType<typeof sandbox>, src = fakeServerSource()) {
  return install({ paths: sb.paths, serverSource: src, node: goodNode });
}

describe("install", () => {
  it("INS-1 install copies the server, writes our exact entry, and says what to press", () => {
    const sb = sandbox();
    const r = run(sb);
    expect(r.exitCode).toBe(0);
    const text = readFileSync(sb.plugins, "utf8");
    const [ours] = JSON.parse(text) as Record<string, unknown>[];
    expect(ours).toEqual({
      id: ENTRY_ID,
      name: "distiller",
      description: "Replaces sensitive values in text with fake ones",
      transport: "stdio",
      command: process.execPath,
      args: [installedServerFile(sb.paths)],
      env: { NODE_OPTIONS: "", NODE_PATH: "" },
      autoConnect: true,
    });
    expect(existsSync(join(installDir(sb.paths), "rulepacks", "default.json"))).toBe(true);
    expect(existsSync(join(installDir(sb.paths), "profiles", "agent.json"))).toBe(true);
    expect(r.lines.join("\n")).toContain("has not been started yet");
    expect(r.lines.join("\n")).toContain("Refresh");
  });

  it("INS-2 install twice: one entry, the second says it is up to date", () => {
    const sb = sandbox();
    run(sb);
    const once = readFileSync(sb.plugins, "utf8");
    const r = run(sb);
    expect(readFileSync(sb.plugins, "utf8")).toBe(once);
    expect(r.lines.join("\n")).toContain("already up to date");
    expect(r.lines.join("\n")).not.toContain("has not been started");
    expect(oursCount(once)).toBe(1);
  });

  it("INS-1 install keeps other entries and replaces a stale copy of the server", () => {
    const sb = sandbox();
    write(sb.plugins, `[\n  ${other}\n]\n`);
    write(join(installDir(sb.paths), "stale.txt"), "x");
    run(sb);
    expect(existsSync(join(installDir(sb.paths), "stale.txt"))).toBe(false);
    expect(otherSlices(readFileSync(sb.plugins, "utf8"))).toEqual([other]);
    expect(readFileSync(sb.plugins + ".bak", "utf8")).toBe(`[\n  ${other}\n]\n`);
  });

  it("INS-1 a malformed list stops the install before anything is copied", () => {
    const sb = sandbox();
    write(sb.plugins, "[{");
    const r = run(sb);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("left untouched");
    expect(readFileSync(sb.plugins, "utf8")).toBe("[{");
    expect(existsSync(dataDir(sb.paths))).toBe(false);
  });

  it("INS-4 no suitable Node stops the install with nothing written", () => {
    const sb = sandbox();
    const r = install({
      paths: sb.paths,
      serverSource: fakeServerSource(),
      node: { execPath: "/none/node", pathEnv: "", run: () => "v16.0.0\n" },
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("Install Node.js 20 or newer");
    expect(existsSync(dataDir(sb.paths))).toBe(false);
    expect(existsSync(sb.plugins)).toBe(false);
  });

  it("INS-1 an incomplete server copy is refused with the fix", () => {
    const sb = sandbox();
    const src = tmp();
    write(join(src, "server.mjs"), "");
    const r = run(sb, src);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("npm run build");
    expect(existsSync(sb.plugins)).toBe(false);
  });

  it("INS-3 a kill at the rename leaves the old list, and the next install succeeds", () => {
    const sb = sandbox();
    write(sb.plugins, `[${other}]\n`);
    expect(() =>
      install({
        paths: sb.paths,
        serverSource: fakeServerSource(),
        node: goodNode,
        fsOps: {
          rename: () => {
            throw new Error("killed");
          },
        },
      }),
    ).toThrow("killed");
    expect(readFileSync(sb.plugins, "utf8")).toBe(`[${other}]\n`);
    expect(run(sb).exitCode).toBe(0);
    expect(oursCount(readFileSync(sb.plugins, "utf8"))).toBe(1);
  });

  it("INS-1 every path stays inside the sandbox", () => {
    const sb = sandbox();
    run(sb);
    const text = readFileSync(sb.plugins, "utf8");
    // The file is JSON, so a Windows path appears in it with its backslashes doubled.
    expect(text).toContain(JSON.stringify(sb.root).slice(1, -1));
    for (const p of [dataDir(sb.paths), sb.plugins]) expect(p.startsWith(sb.root)).toBe(true);
  });
});

describe("uninstall", () => {
  const never = async () => {
    throw new Error("must not ask");
  };

  it("INS-6 removes ours and only ours, keeps the data directory without a yes", async () => {
    const sb = sandbox();
    const a = '{"id":"1","name":"alpha"}';
    const b = '{ "id":"2",\t"name":"beta" }';
    write(sb.plugins, `[\n  ${a},\n  ${b}\n]\n`);
    run(sb);
    write(join(dataDir(sb.paths), "distiller.log"), '{"event":"start"}\n');
    const r = await uninstall({ paths: sb.paths, yes: false, confirm: async () => false });
    expect(r.exitCode).toBe(0);
    const text = readFileSync(sb.plugins, "utf8");
    expect(otherSlices(text)).toEqual([a, b]);
    expect(oursCount(text)).toBe(0);
    expect(existsSync(installDir(sb.paths))).toBe(false);
    expect(existsSync(join(dataDir(sb.paths), "distiller.log"))).toBe(true);
  });

  it("INS-6 removes the data directory after a yes", async () => {
    const sb = sandbox();
    run(sb);
    write(join(dataDir(sb.paths), "distiller.log"), "x");
    let asked = "";
    await uninstall({ paths: sb.paths, yes: false, confirm: async (q) => ((asked = q), true) });
    expect(asked).toContain(dataDir(sb.paths));
    expect(existsSync(dataDir(sb.paths))).toBe(false);
  });

  it("INS-6 --yes removes it without asking", async () => {
    const sb = sandbox();
    run(sb);
    await uninstall({ paths: sb.paths, yes: true, confirm: never });
    expect(existsSync(dataDir(sb.paths))).toBe(false);
  });

  it("INS-6 nothing installed: succeeds, touches nothing", async () => {
    const sb = sandbox();
    write(sb.plugins, `[${other}]\n`);
    const r = await uninstall({ paths: sb.paths, yes: false, confirm: never });
    expect(r.exitCode).toBe(0);
    expect(readFileSync(sb.plugins, "utf8")).toBe(`[${other}]\n`);
    expect(existsSync(sb.plugins + ".bak")).toBe(false);
  });

  it("INS-6 a malformed list: refused, the installed copy is kept", async () => {
    const sb = sandbox();
    run(sb);
    write(sb.plugins, "not json");
    const r = await uninstall({ paths: sb.paths, yes: true, confirm: never });
    expect(r.exitCode).toBe(1);
    expect(existsSync(installDir(sb.paths))).toBe(true);
    expect(readFileSync(sb.plugins, "utf8")).toBe("not json");
  });

  it("INS-6 files of other tools in the settings directory are never touched", async () => {
    const sb = sandbox();
    run(sb);
    write(join(sb.plugins, "..", "settings.json"), "{}");
    mkdirSync(join(sb.plugins, "..", "addons"), { recursive: true });
    await uninstall({ paths: sb.paths, yes: true, confirm: never });
    expect(readdirSync(join(sb.plugins, "..")).sort()).toEqual([
      "addons",
      "mcp-plugins.json",
      "mcp-plugins.json.bak",
      "settings.json",
    ]);
  });
});
