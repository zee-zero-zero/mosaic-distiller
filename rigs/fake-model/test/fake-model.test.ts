// Tests of the fake model itself (step 3.3), with a plain HTTP client, before any MosAIc test
// relies on it: it replays a script exactly, in the NDJSON format MosAIc's ollama provider reads,
// records the system prompt, and misbehaves on request.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLOSING_SENTENCE, startFakeModel, type FakeModel } from "../src/index.js";

let model: FakeModel;
beforeEach(async () => {
  model = await startFakeModel();
});
afterEach(async () => {
  await model.close();
});

const body = (stream: boolean, system = "SYS") =>
  JSON.stringify({
    model: "m",
    stream,
    messages: [
      { role: "system", content: system },
      { role: "user", content: "hello" },
    ],
  });

async function post(stream: boolean, system?: string) {
  return fetch(`${model.url}/api/chat`, { method: "POST", body: body(stream, system) });
}

/** Reads a stream the way `handleOllamaStream` does: split on newlines, skip what is not JSON. */
async function readLikeMosaic(
  res: Response,
): Promise<{ text: string; done: boolean; bad: number }> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let text = "";
  let done = false;
  let bad = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    for (const l of dec
      .decode(r.value)
      .split("\n")
      .filter((x) => x.trim())) {
      try {
        const p = JSON.parse(l);
        text += p.message?.content || "";
        if (p.done) done = true;
      } catch {
        bad++;
      }
    }
  }
  return { text, done, bad };
}

describe("FM-1 the fake model replays a script exactly", () => {
  it("FM-1 a streamed reply arrives whole, in chunks, ending with a done object", async () => {
    const reply =
      'Calling. <use_tool server="distiller" tool="distill">{"text":"a"}</use_tool> é😀';
    model.load([{ content: reply, chunkSize: 5 }]);
    const out = await readLikeMosaic(await post(true));
    expect(out.text).toBe(reply);
    expect(out.done).toBe(true);
    expect(out.bad).toBe(0);
  });

  it("FM-1 a non-streamed reply is one JSON object holding the content", async () => {
    model.load(["first"]);
    const data = (await (await post(false)).json()) as { message: { content: string } };
    expect(data.message.content).toBe("first");
  });

  it("FM-1 replies are taken in order, and an exhausted script answers with the closing sentence", async () => {
    model.load(["one", "two"]);
    const got: string[] = [];
    for (let i = 0; i < 3; i++) got.push((await readLikeMosaic(await post(true))).text);
    expect(got).toEqual(["one", "two", CLOSING_SENTENCE]);
  });

  it("FM-1 a reply may be computed from the request", async () => {
    model.load([(r) => `you said ${r.lastMessage}`]);
    expect((await readLikeMosaic(await post(true))).text).toBe("you said hello");
  });

  it("FM-1 load starts the script again", async () => {
    model.load(["a"]);
    await post(true);
    model.load(["b"]);
    expect((await readLikeMosaic(await post(true))).text).toBe("b");
  });
});

describe("FM-2 the fake model records what it receives", () => {
  it("FM-2 the system prompt, the model, the stream flag and the last message are recorded", async () => {
    model.load(["x"]);
    await post(true, "THE SYSTEM PROMPT\nwith lines");
    const r = model.chatRequests()[0];
    expect(r?.systemPrompt).toBe("THE SYSTEM PROMPT\nwith lines");
    expect(r?.model).toBe("m");
    expect(r?.stream).toBe(true);
    expect(r?.lastMessage).toBe("hello");
    expect(r?.messages).toHaveLength(2);
  });

  it("FM-2 a first message that starts with [System Context] is the system prompt, as MosAIc sends it", async () => {
    await fetch(`${model.url}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: "m",
        stream: true,
        messages: [
          { role: "user", content: "[System Context]\nTOOLS" },
          { role: "user", content: "hello" },
        ],
      }),
    });
    expect(model.chatRequests()[0]?.systemPrompt).toBe("[System Context]\nTOOLS");
  });

  it("FM-2 a request with no system message records null, and a body that is not JSON is kept", async () => {
    await fetch(`${model.url}/api/chat`, { method: "POST", body: "{not json" });
    const r = model.chatRequests()[0];
    expect(r?.systemPrompt).toBeNull();
    expect(r?.body).toBe("{not json");
  });

  it("FM-2 other paths are recorded apart from the chats, and unknown ones are 404", async () => {
    expect((await fetch(`${model.url}/nowhere`)).status).toBe(404);
    expect((await fetch(`${model.url}/api/tags`)).status).toBe(200);
    expect(model.requests).toHaveLength(2);
    expect(model.chatRequests()).toHaveLength(0);
  });

  it("FM-2 waitForChats resolves when the requests have arrived, and rejects when they do not", async () => {
    const waiting = model.waitForChats(2, 5000);
    await post(true);
    await post(true);
    await waiting;
    await expect(model.waitForChats(3, 100)).rejects.toThrow(/only 2 of 3/);
  });
});

describe("FM-3 the fake model misbehaves on request", () => {
  it("FM-3 a truncated stream delivers part of the content and ends without a done object", async () => {
    const content = "0123456789".repeat(10);
    model.load([{ content, delivery: "truncated", chunkSize: 10 }]);
    const res = await post(true);
    let text = "";
    let failed = false;
    try {
      const out = await readLikeMosaic(res);
      text = out.text;
      expect(out.done).toBe(false);
    } catch {
      failed = true; // a cut connection may also surface as a read error
    }
    expect(failed || (text.length > 0 && text.length < content.length)).toBe(true);
  });

  it("FM-3 a malformed stream has lines that are not JSON, and the content in one that is", async () => {
    model.load([{ content: "payload", delivery: "malformed" }]);
    const out = await readLikeMosaic(await post(true));
    expect(out.bad).toBeGreaterThan(0);
    expect(out.text).toBe("payload");
  });

  it("FM-3 a stalled stream sends its first chunk and then nothing until the server is closed", async () => {
    model.load([{ content: "abcdefghijklmnopqrstuvwxyz", delivery: "stalled", chunkSize: 4 }]);
    const res = await post(true);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value)).message.content).toBe("abcd");
    const second = await Promise.race([
      reader.read().then(
        () => "data",
        () => "closed",
      ),
      new Promise((r) => setTimeout(() => r("silent"), 300)),
    ]);
    expect(second).toBe("silent");
  });
});
