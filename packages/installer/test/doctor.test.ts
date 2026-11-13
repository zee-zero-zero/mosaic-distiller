// Tests of `doctor` and of the command line, which start processes (local and full tiers only):
// doctor against a stand-in MCP server written to a temporary directory, and once against the
// real server bundle when it has been built; the command line's usage, uninstall prompts and doctor.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/doctor";
import { install } from "../src/install";
import { dataDir, installDir, installedServerFile } from "../src/paths";
import { fakeServerSource, sandbox, spawnTier, write } from "./helpers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A stand-in MCP server speaking raw JSON-RPC lines, with a few ways of misbehaving. */
function fakeServer(mode: "good" | "no-tools" | "dies" | "silent"): string {
  return `
import { createInterface } from "node:readline";
const mode = ${JSON.stringify(mode)};
if (mode === "dies") { process.stderr.write("DISTILLER_START_FAILED PACK_FORMAT\\n"); process.exit(2); }
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  if (mode === "silent") return;
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: (mode === "no-tools" ? ["distill"] : ["distill", "capabilities"]).map((name) => ({ name, inputSchema: { type: "object" } })) } });
  else if (m.method === "tools/call") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify({ rulepack: { name: "default", version: "1.0.0" } }) }] } });
});
`;
}

function installed(mode: Parameters<typeof fakeServer>[0]) {
  const sb = sandbox();
  const r = install({
    paths: sb.paths,
    serverSource: fakeServerSource(fakeServer(mode)),
    node: { execPath: process.execPath, pathEnv: undefined },
  });
  expect(r.exitCode).toBe(0);
  return sb;
}
const parent = (sb: ReturnType<typeof sandbox>) => ({ ...process.env, ...sb.paths.env });

describe.skipIf(!spawnTier())("doctor", () => {
  it("doctor: doctor passes on a good installation and ends with the passing line", async () => {
    const sb = installed("good");
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(r.lines.join("\n")).toContain("the rule pack loads (default 1.0.0)");
    expect(r.lines.join("\n")).toContain("MosAIc version: unknown");
    expect(r.lines[r.lines.length - 1]).toBe("all checks passed");
    expect(r.exitCode).toBe(0);
  });

  it("doctor: doctor with no entry says to run install", async () => {
    const sb = sandbox();
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain('fix: run "install"');
    expect(r.lines.join("\n")).not.toContain("all checks passed");
  });

  it("doctor: a missing server file is reported with its fix", async () => {
    const sb = installed("good");
    rmSync(installedServerFile(sb.paths));
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("FAIL files");
  });

  it("doctor: a recorded Node that is gone is reported", async () => {
    const sb = installed("good");
    const text = readFileSync(sb.plugins, "utf8").replace(process.execPath, "/gone/node");
    write(sb.plugins, text);
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("FAIL files");
  });

  it("doctor: a server that refuses to start is reported with its fixed code", async () => {
    const sb = installed("dies");
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb), timeoutSeconds: 10 });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("DISTILLER_START_FAILED PACK_FORMAT");
  });

  it("doctor: a server missing a tool is reported", async () => {
    const sb = installed("no-tools");
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("FAIL server");
  });

  it("doctor: a server that never answers is given up on", async () => {
    const sb = installed("silent");
    const r = await doctor({ paths: sb.paths, parentEnv: parent(sb), timeoutSeconds: 1 });
    expect(r.exitCode).toBe(1);
    expect(r.lines.join("\n")).toContain("no answer in time");
  });

  it("doctor: the entry's blank NODE_OPTIONS wins over a hostile parent value", async () => {
    const sb = installed("good");
    const r = await doctor({
      paths: sb.paths,
      parentEnv: { ...parent(sb), NODE_OPTIONS: "--require /nonexistent/marker.js" },
    });
    expect(r.exitCode).toBe(0);
  });

  const bundle = join(root, "packages/installer/dist/server/server.mjs");
  it.skipIf(!existsSync(bundle))("doctor: doctor on the real server bundle", async () => {
    const sb = sandbox();
    const r = install({
      paths: sb.paths,
      serverSource: dirname(bundle),
      node: { execPath: process.execPath, pathEnv: undefined },
    });
    expect(r.exitCode).toBe(0);
    const d = await doctor({ paths: sb.paths, parentEnv: parent(sb) });
    expect(d.lines.join("\n")).toContain("all checks passed");
  });
});

describe.skipIf(!spawnTier())("command line", () => {
  const cli = join(root, "packages/installer/src/cli.ts");
  const go = (sb: ReturnType<typeof sandbox>, args: string[], input = "") =>
    spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
      cwd: root,
      encoding: "utf8",
      input,
      env: { ...process.env, ...sb.paths.env, HOME: sb.paths.home },
    });

  it("INS-6 usage errors exit 2 and print the usage", () => {
    const sb = sandbox();
    for (const args of [
      [],
      ["bogus"],
      ["install", "--force"],
      ["uninstall", "--no"],
      ["doctor", "x"],
    ]) {
      const r = go(sb, args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Usage");
    }
  });

  it("INS-6 uninstall asks, and an empty or negative answer keeps the data directory", () => {
    const sb = sandbox();
    for (const input of ["", "n\n", "yes please\n"]) {
      write(join(dataDir(sb.paths), "distiller.log"), "x");
      const r = go(sb, ["uninstall"], input);
      expect(r.status).toBe(0);
      expect(existsSync(dataDir(sb.paths))).toBe(true);
    }
  });

  it("INS-6 a y answer removes the data directory, and --yes does too", () => {
    const sb = sandbox();
    write(join(dataDir(sb.paths), "distiller.log"), "x");
    expect(go(sb, ["uninstall"], "y\n").status).toBe(0);
    expect(existsSync(dataDir(sb.paths))).toBe(false);
    write(join(dataDir(sb.paths), "distiller.log"), "x");
    expect(go(sb, ["uninstall", "--yes"]).status).toBe(0);
    expect(existsSync(dataDir(sb.paths))).toBe(false);
    expect(existsSync(installDir(sb.paths))).toBe(false);
  });

  it("doctor: doctor from the command line fails on a machine with nothing installed", () => {
    const sb = sandbox();
    const r = go(sb, ["doctor"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL entry");
  });
});
