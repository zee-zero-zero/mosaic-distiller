// Provides the fake model of the end-to-end rig (§5.8): an HTTP server on 127.0.0.1, on a random
// port, that speaks the part of Ollama's API that MosAIc's "ollama" provider uses
// (`AIService.sendToOllama`, `handleOllamaStream` at MosAIc `7af40c8`): `POST /api/chat` with
// `{model, messages, stream}`, answered by newline-delimited JSON objects
// `{message: {content}, done}` when `stream` is true and by one `{message: {content}}` object
// otherwise. A test loads a script of replies; each request takes the next reply, and an exhausted
// script answers with a fixed closing sentence. Every request is recorded, with its system prompt.
// A reply can misbehave on request: a truncated stream, a stalled stream, malformed JSON.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** How a reply is delivered. */
export type Delivery =
  | "normal" // the whole content, then the closing object
  | "truncated" // the first half of the content, then the connection is cut
  | "stalled" // the first chunk, then silence until the server is closed
  | "malformed"; // lines that are not JSON, and one that is, holding the content

export interface ReplySpec {
  content: string;
  delivery?: Delivery;
  /** How many characters each streamed object carries; default 12. */
  chunkSize?: number;
}

export type Reply = string | ReplySpec;

export interface ChatMessage {
  role: string;
  content: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  model: string | null;
  stream: boolean;
  messages: ChatMessage[];
  /**
   * The system prompt: the content of the first message whose role is "system", or, as MosAIc
   * sends it (`Chatview.tsx`, `sendMessage`), the first message that starts with `[System Context]`;
   * null when there is none.
   */
  systemPrompt: string | null;
  /** The content of the last message; null when there are no messages. */
  lastMessage: string | null;
  body: string;
}

export const CLOSING_SENTENCE = "Done.";

export interface FakeModel {
  readonly url: string;
  readonly port: number;
  /** Every request received, in order. */
  readonly requests: RecordedRequest[];
  /** Only the requests to `/api/chat`. */
  chatRequests(): RecordedRequest[];
  /** Replaces the script of replies and forgets the position in it. */
  load(replies: Array<Reply | ((request: RecordedRequest) => Reply)>): void;
  /** Resolves when `n` chat requests have been received, or rejects after `timeoutMs`. */
  waitForChats(n: number, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

function normalise(reply: Reply): Required<ReplySpec> {
  const spec: ReplySpec = typeof reply === "string" ? { content: reply } : reply;
  return {
    content: spec.content,
    delivery: spec.delivery ?? "normal",
    chunkSize: spec.chunkSize ?? 12,
  };
}

function chunks(text: string, size: number): string[] {
  const parts = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += size) out.push(parts.slice(i, i + size).join(""));
  return out;
}

function record(req: IncomingMessage, body: string): RecordedRequest {
  let parsed: { model?: unknown; stream?: unknown; messages?: unknown } = {};
  try {
    const v: unknown = JSON.parse(body);
    if (typeof v === "object" && v !== null) parsed = v as typeof parsed;
  } catch {
    /* a body that is not JSON is recorded as it came */
  }
  const messages: ChatMessage[] = Array.isArray(parsed.messages)
    ? parsed.messages.map((m: { role?: unknown; content?: unknown }) => ({
        role: String(m?.role ?? ""),
        content: typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""),
      }))
    : [];
  const system =
    messages.find((m) => m.role === "system") ??
    messages.find((m) => m.content.startsWith("[System Context]"));
  return {
    method: req.method ?? "",
    path: (req.url ?? "").split("?")[0] as string,
    model: typeof parsed.model === "string" ? parsed.model : null,
    stream: parsed.stream === true,
    messages,
    systemPrompt: system ? system.content : null,
    lastMessage:
      messages.length > 0 ? (messages[messages.length - 1] as ChatMessage).content : null,
    body,
  };
}

function line(content: string, done: boolean): string {
  return (
    JSON.stringify({
      model: "fake",
      created_at: "2000-01-01T00:00:00Z",
      message: { role: "assistant", content },
      done,
    }) + "\n"
  );
}

export async function startFakeModel(): Promise<FakeModel> {
  const requests: RecordedRequest[] = [];
  let script: Array<Reply | ((request: RecordedRequest) => Reply)> = [];
  let position = 0;
  const sockets = new Set<Socket>();
  const waiters: Array<{ n: number; resolve: () => void }> = [];

  const chats = () => requests.filter((r) => r.path === "/api/chat");

  function deliver(res: ServerResponse, request: RecordedRequest, spec: Required<ReplySpec>): void {
    if (!request.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "fake",
          message: { role: "assistant", content: spec.content },
          done: true,
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    const parts = chunks(spec.content, spec.chunkSize);
    if (spec.delivery === "malformed") {
      res.write("this is not json\n");
      res.write('{"message": {"content": \n');
      res.write(line(spec.content, false));
      res.write("}}}\n");
      res.end(line("", true));
    } else if (spec.delivery === "truncated") {
      for (const p of parts.slice(0, Math.max(1, Math.floor(parts.length / 2))))
        res.write(line(p, false));
      // Cut the connection without the closing object and without the end of the body.
      setTimeout(() => res.destroy(), 20);
    } else if (spec.delivery === "stalled") {
      if (parts[0] !== undefined) res.write(line(parts[0], false));
      // Nothing more is written; `close` ends the socket.
    } else {
      for (const p of parts) res.write(line(p, false));
      res.end(line("", true));
    }
  }

  const server: Server = createServer((req, res) => {
    const bodyParts: Buffer[] = [];
    req.on("data", (c: Buffer) => bodyParts.push(c));
    req.on("end", () => {
      const request = record(req, Buffer.concat(bodyParts).toString("utf8"));
      requests.push(request);
      if (request.method === "POST" && request.path === "/api/chat") {
        const next = script[position++];
        const reply: Reply =
          next === undefined ? CLOSING_SENTENCE : typeof next === "function" ? next(request) : next;
        deliver(res, request, normalise(reply));
        for (const w of [...waiters]) {
          if (chats().length >= w.n) {
            waiters.splice(waiters.indexOf(w), 1);
            w.resolve();
          }
        }
      } else if (request.path === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "fake" }] }));
      } else if (request.path === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: "0.0.0-fake" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    chatRequests: chats,
    load(replies) {
      script = replies;
      position = 0;
    },
    waitForChats(n, timeoutMs = 30_000) {
      if (chats().length >= n) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const w = { n, resolve: () => (clearTimeout(timer), resolve()) };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`only ${chats().length} of ${n} chat requests arrived`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
