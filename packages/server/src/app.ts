// Provides createDistillerServer: the MCP `Server` (the SDK's low-level class, so that argument
// validation and error results are ours) with handlers for `tools/list` and `tools/call`, and
// buildToolResult, the one function that makes a tool result and so the one place where every
// returned text is neutralised (§4.5). A test entry may add tools through `extraTools`.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ENGINE_VERSION, refusal, serializeResult } from "@mosaic-distiller/core";
import type { RefusalCode } from "@mosaic-distiller/core";
import type { ContentFreeLog, LogOutcome, LogTool } from "./safeguards/log";
import { neutraliseOutbound } from "./safeguards/neutralise";
import type { EnginePool } from "./pool";
import {
  CAPABILITIES_DESCRIPTION,
  CAPABILITIES_SCHEMA,
  DISTILL_DESCRIPTION,
  DISTILL_SCHEMA,
  parseDistillArguments,
} from "./tools";

export const MAX_RESULT_BYTES = 4 * 1024 * 1024;
export const SERVER_NAME = "distiller";

/** The one place a tool result is made: every text passes through neutraliseOutbound. */
export function buildToolResult(text: string, isError: boolean): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text: neutraliseOutbound(text) }] };
  if (isError) result.isError = true;
  return result;
}

export function refusalResult(code: RefusalCode): CallToolResult {
  return buildToolResult(serializeResult(refusal(code)), true);
}

/** A tool a test entry adds. Never present in the installed server. */
export interface ExtraTool {
  tool: Tool;
  call(args: unknown): Promise<CallToolResult>;
}

export interface ServerParts {
  pool: EnginePool;
  /** The text of the `capabilities` result, computed once at start-up. */
  capabilitiesText: string;
  log: ContentFreeLog;
  extraTools?: ExtraTool[];
}

export function createDistillerServer(parts: ServerParts): Server {
  const { pool, capabilitiesText, log } = parts;
  const extra = new Map((parts.extraTools ?? []).map((t) => [t.tool.name, t]));
  const server = new Server(
    { name: SERVER_NAME, version: ENGINE_VERSION },
    { capabilities: { tools: {} } },
  );

  const tools: Tool[] = [
    {
      name: "distill",
      description: DISTILL_DESCRIPTION,
      inputSchema: DISTILL_SCHEMA as Tool["inputSchema"],
    },
    {
      name: "capabilities",
      description: CAPABILITIES_DESCRIPTION,
      inputSchema: CAPABILITIES_SCHEMA as Tool["inputSchema"],
    },
    ...[...extra.values()].map((e) => e.tool),
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  const done = (tool: LogTool, started: number, outcome: LogOutcome, result: CallToolResult) => {
    const first = result.content[0];
    log.write({
      code: "result",
      tool,
      outcome,
      ms: Date.now() - started,
      bytes: first !== undefined && first.type === "text" ? Buffer.byteLength(first.text) : 0,
    });
    return result;
  };

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const started = Date.now();
    const name = request.params.name;
    const args: unknown = request.params.arguments;
    try {
      if (name === "capabilities") {
        log.write({ code: "call", tool: "capabilities" });
        return done("capabilities", started, "ok", buildToolResult(capabilitiesText, false));
      }
      if (name === "distill") {
        const parsed = parseDistillArguments(args);
        log.write({
          code: "call",
          tool: "distill",
          ...(parsed.ok ? { segments: parsed.request.segments.length } : {}),
        });
        if (!parsed.ok) return done("distill", started, "refused", refusalResult(parsed.code));
        const answer = await pool.call({ kind: "distill", request: parsed.request });
        if (answer.outcome === "deadline") log.write({ code: "deadline", tool: "distill" });
        if (Buffer.byteLength(answer.text) > MAX_RESULT_BYTES) {
          return done("distill", started, "too_large", refusalResult("RESULT_TOO_LARGE"));
        }
        const outcome: LogOutcome =
          answer.outcome === "internal" ? "internal" : answer.refused ? "refused" : "ok";
        return done("distill", started, outcome, buildToolResult(answer.text, answer.refused));
      }
      const hook = extra.get(name);
      if (hook !== undefined) return await hook.call(args);
      log.write({ code: "call", tool: "other" });
      return done("other", started, "refused", refusalResult("INVALID_ARGUMENTS"));
    } catch {
      return done("other", started, "internal", refusalResult("INTERNAL"));
    }
  });

  return server;
}
