// Provides `doctor` (§6.3): makes each check of an installation and reports the fix for each
// failure. It starts the installed server exactly as MosAIc would (the entry's command, arguments
// and `env` over the parent's environment), lists its tools and calls `capabilities`.
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import type { Outcome } from "./install";
import { MIN_NODE_MAJOR, parseNodeVersion } from "./node-finder";
import { pluginsFile, type PathEnv } from "./paths";
import { readOurEntry } from "./plugins-file";

export interface DoctorOptions {
  paths: PathEnv;
  /** The environment the server is started with, under the entry's `env`. */
  parentEnv: Record<string, string | undefined>;
  /** Seconds to wait for the server; default 15. */
  timeoutSeconds?: number;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

/** Starts the entry and returns the tool names and the rule-pack line, or a failure text. */
async function probe(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ tools: string[]; pack: string } | { error: string }> {
  const transport = new StdioClientTransport({ command, args, env, stderr: "pipe" });
  const client = new Client({ name: "distiller-doctor", version: "0.1.0" }, { capabilities: {} });
  let stderr = "";
  transport.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
  const run = async (): Promise<{ tools: string[]; pack: string }> => {
    await client.connect(transport);
    const list = await client.listTools();
    const caps = await client.callTool({ name: "capabilities", arguments: {} });
    const block = (caps.content as { type: string; text?: string }[] | undefined)?.[0];
    const parsed = JSON.parse(block?.text ?? "null") as {
      rulepack?: { name: string; version: string };
    };
    const rp = parsed.rulepack;
    if (rp === undefined) throw new Error("capabilities reported no rule pack");
    return { tools: list.tools.map((t) => t.name), pack: `${rp.name} ${rp.version}` };
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("no answer in time")), timeoutMs);
      }),
    ]);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 100)); // let the child's last stderr line arrive
    const code = /DISTILLER_START_FAILED \S+/.exec(stderr)?.[0];
    return { error: code ?? (e as Error).message };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

export async function doctor(o: DoctorOptions): Promise<Outcome> {
  const checks: Check[] = [];
  const file = pluginsFile(o.paths);
  const entry = readOurEntry(file);
  checks.push(
    entry !== null
      ? { name: "entry", ok: true, detail: `the "distiller" entry is in ${file}` }
      : {
          name: "entry",
          ok: false,
          detail: `no readable "distiller" entry in ${file}`,
          fix: 'run "install"',
        },
  );
  if (entry !== null) {
    const command = typeof entry.command === "string" ? entry.command : "";
    const args = Array.isArray(entry.args)
      ? entry.args.filter((a): a is string => typeof a === "string")
      : [];
    const missing = [command, ...args].filter((p) => p === "" || !existsSync(p));
    checks.push(
      missing.length === 0
        ? { name: "files", ok: true, detail: "the entry's command and server file exist" }
        : {
            name: "files",
            ok: false,
            detail: `missing: ${missing.join(", ") || "the command"}`,
            fix: 'run "install" again',
          },
    );
    let nodeOk = false;
    let nodeDetail = "the recorded Node.js cannot run";
    if (command !== "" && existsSync(command)) {
      try {
        const out = execFileSync(command, ["--version"], {
          encoding: "utf8",
          timeout: 10_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        const v = parseNodeVersion(out);
        nodeOk = v !== null && v.major >= MIN_NODE_MAJOR;
        nodeDetail = v === null ? "the recorded Node.js gave no version" : `Node.js ${v.text}`;
        if (!nodeOk && v !== null) nodeDetail += `, older than ${MIN_NODE_MAJOR}`;
      } catch {
        /* nodeDetail already says it */
      }
    }
    checks.push(
      nodeOk
        ? { name: "node", ok: true, detail: nodeDetail }
        : {
            name: "node",
            ok: false,
            detail: nodeDetail,
            fix: `install Node.js ${MIN_NODE_MAJOR} or newer, then run "install" again`,
          },
    );
    if (missing.length === 0 && nodeOk) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries({
        ...o.parentEnv,
        ...((entry.env as Record<string, string | undefined>) ?? {}),
      })) {
        if (v !== undefined) env[k] = v;
      }
      const r = await probe(command, args, env, (o.timeoutSeconds ?? 15) * 1000);
      if ("error" in r) {
        checks.push({
          name: "server",
          ok: false,
          detail: `the server did not answer: ${r.error}`,
          fix: 'run "install" again; if it persists, the rule pack may be damaged',
        });
      } else {
        const both = r.tools.includes("distill") && r.tools.includes("capabilities");
        checks.push(
          both
            ? {
                name: "server",
                ok: true,
                detail: `the server starts and lists ${r.tools.join(", ")}`,
              }
            : {
                name: "server",
                ok: false,
                detail: `the server lists ${r.tools.join(", ") || "no tools"}`,
                fix: 'run "install" again',
              },
        );
        if (both)
          checks.push({ name: "rulepack", ok: true, detail: `the rule pack loads (${r.pack})` });
      }
    }
  }
  checks.push({ name: "mosaic", ok: true, detail: "MosAIc version: unknown (not detected)" });
  const lines = checks.map(
    (c) =>
      `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}${c.ok ? "" : ` -> fix: ${c.fix ?? ""}`}`,
  );
  const allOk = checks.every((c) => c.ok);
  if (allOk) lines.push("all checks passed");
  return { exitCode: allOk ? 0 : 1, lines };
}
