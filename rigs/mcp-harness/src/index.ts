// Provides the stdio test harness (§5.6): it starts an MCP server as a child process, builds the
// child's environment the way MosAIc does (the parent's environment with the entry's `env` laid
// over it, undefined values dropped), and talks to it with the MCP SDK's client. In its default
// "strict" mode it owns the child's stdout, and records every line that is not one well-formed
// JSON-RPC message as a protocol violation; the "sdk" mode uses the SDK's own StdioClientTransport,
// as MosAIc does, and records the transport's parse errors as violations.
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  JSONRPCMessageSchema,
  type CallToolResult,
  type JSONRPCMessage,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** What MosAIc's entry for a stdio server holds: a command, its arguments and an `env`. */
export interface Entry {
  command: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export interface StartOptions {
  /** The environment of the parent process; defaults to `process.env`. */
  parentEnv?: Record<string, string | undefined>;
  mode?: "strict" | "sdk";
  cwd?: string;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** `electron/integrations/mcp/MCPClient.ts:151-201` at MosAIc `7af40c8`: the entry's `env` wins. */
export function mosaicEnvironment(
  parent: Record<string, string | undefined>,
  entryEnv: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...parent, ...(entryEnv ?? {}) })) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Splits bytes from a child's stdout into lines and checks each one: valid UTF-8, one JSON-RPC
 * message, terminated by a newline. Anything else is a violation.
 */
export class StrictReader {
  readonly violations: string[] = [];
  readonly raw: Buffer[] = [];
  private pending = Buffer.alloc(0);

  constructor(private readonly onMessage: (m: JSONRPCMessage) => void) {}

  push(chunk: Buffer): void {
    this.raw.push(chunk);
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const nl = this.pending.indexOf(0x0a);
      if (nl < 0) return;
      const line = this.pending.subarray(0, nl);
      this.pending = this.pending.subarray(nl + 1);
      this.line(line);
    }
  }

  /** At the end of the stream, bytes without a final newline are a violation. */
  end(): void {
    if (this.pending.length > 0) {
      this.violations.push(`${this.pending.length} bytes without a newline at the end of stdout`);
      this.pending = Buffer.alloc(0);
    }
  }

  private line(bytes: Buffer): void {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      this.violations.push("a line of stdout is not UTF-8");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.violations.push(`a line of stdout is not JSON: ${JSON.stringify(text.slice(0, 80))}`);
      return;
    }
    const parsed = JSONRPCMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.violations.push("a line of stdout is JSON but not a JSON-RPC message");
      return;
    }
    this.onMessage(parsed.data);
  }
}

class StrictTransport implements Transport {
  onclose?: () => void;
  onerror?: (e: Error) => void;
  onmessage?: (m: JSONRPCMessage) => void;
  readonly reader = new StrictReader((m) => this.onmessage?.(m));
  readonly stderrChunks: Buffer[] = [];
  readonly exited: Promise<ExitInfo>;
  readonly child: ChildProcess;

  constructor(entry: Entry, env: Record<string, string>, cwd: string | undefined) {
    this.child = spawn(entry.command, entry.args ?? [], {
      env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout?.on("data", (c: Buffer) => this.reader.push(c));
    this.child.stderr?.on("data", (c: Buffer) => this.stderrChunks.push(c));
    this.child.stdin?.on("error", () => undefined);
    this.exited = new Promise<ExitInfo>((resolve) => {
      this.child.on("close", (code, signal) => {
        this.reader.end();
        resolve({ code, signal });
        this.onclose?.();
      });
      this.child.on("error", (e) => {
        this.onerror?.(e);
        resolve({ code: null, signal: null });
      });
    });
  }

  async start(): Promise<void> {
    if (this.child.pid === undefined) {
      await new Promise<void>((resolve) => this.child.once("error", () => resolve()));
      throw new Error("the server process did not start");
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const stdin = this.child.stdin;
      if (stdin === null || stdin.destroyed) return reject(new Error("stdin is closed"));
      stdin.write(serializeMessage(message), (e) => (e ? reject(e) : resolve()));
    });
  }

  async close(): Promise<void> {
    this.child.stdin?.end();
  }
}

export class McpHarness {
  private constructor(
    readonly client: Client,
    private readonly strict: StrictTransport | undefined,
    private readonly sdk: StdioClientTransport | undefined,
    private readonly sdkViolations: string[],
    private readonly sdkStderr: Buffer[],
  ) {}

  static async start(entry: Entry, options: StartOptions = {}): Promise<McpHarness> {
    const env = mosaicEnvironment(options.parentEnv ?? process.env, entry.env);
    const client = new Client({ name: "mcp-harness", version: "1.0.0" }, { capabilities: {} });
    if ((options.mode ?? "strict") === "sdk") {
      const sdk = new StdioClientTransport({
        command: entry.command,
        args: entry.args ?? [],
        env,
        stderr: "pipe",
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      });
      const violations: string[] = [];
      const stderr: Buffer[] = [];
      sdk.stderr?.on("data", (c: Buffer) => stderr.push(c));
      sdk.onerror = (e) => violations.push(`transport error: ${e.message}`);
      const h = new McpHarness(client, undefined, sdk, violations, stderr);
      await client.connect(sdk);
      sdk.onerror = (e) => violations.push(`transport error: ${e.message}`);
      return h;
    }
    const strict = new StrictTransport(entry, env, options.cwd);
    const h = new McpHarness(client, strict, undefined, [], []);
    await client.connect(strict);
    return h;
  }

  /** Lines of the server's stdout that were not protocol messages (strict mode), or transport errors (sdk mode). */
  get violations(): string[] {
    return this.strict !== undefined ? this.strict.reader.violations : this.sdkViolations;
  }

  /** Every byte the server wrote to stdout (strict mode only). */
  get stdoutBytes(): Buffer {
    return Buffer.concat(this.strict?.reader.raw ?? []);
  }

  /** Everything the server wrote to stderr so far. */
  get stderr(): string {
    return Buffer.concat(this.strict?.stderrChunks ?? this.sdkStderr).toString("utf8");
  }

  get pid(): number | undefined {
    return this.strict?.child.pid ?? this.sdk?.pid ?? undefined;
  }

  /** Resolves when the server process has ended (strict mode only). */
  get exited(): Promise<ExitInfo> {
    if (this.strict === undefined) throw new Error("exited is available in strict mode only");
    return this.strict.exited;
  }

  async listTools(): Promise<Tool[]> {
    return (await this.client.listTools()).tools;
  }

  /** Calls a tool. `args` may be anything, so that a test can send what MosAIc never would. */
  async callTool(name: string, args?: unknown, timeoutMs = 60_000): Promise<CallToolResult> {
    const params: Record<string, unknown> = { name };
    if (args !== undefined) params.arguments = args;
    return (await this.client.request({ method: "tools/call", params }, CallToolResultSchema, {
      timeout: timeoutMs,
    })) as CallToolResult;
  }

  /** The text of the first content block of a result. */
  static text(result: CallToolResult): string {
    const first = result.content[0];
    if (first === undefined || first.type !== "text") throw new Error("no text block");
    return first.text;
  }

  /** Ends the client the way a crash would: both pipes are destroyed, the server is not signalled. */
  killClient(): void {
    const c = this.strict?.child;
    if (c === undefined) throw new Error("killClient is available in strict mode only");
    c.stdin?.destroy();
    c.stdout?.destroy();
    c.stderr?.destroy();
  }

  /** Signals the server process itself. */
  kill(signal: NodeJS.Signals = "SIGKILL"): void {
    this.strict?.child.kill(signal);
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // The server may already be gone.
    }
    if (this.strict !== undefined) {
      const race = await Promise.race([
        this.strict.exited,
        new Promise<null>((r) => setTimeout(() => r(null), 3000).unref()),
      ]);
      if (race === null) this.strict.child.kill("SIGKILL");
    }
  }
}
