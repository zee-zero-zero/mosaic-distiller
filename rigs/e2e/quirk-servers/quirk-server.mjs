// A small MCP server over stdio for the quirk suite (§5.8, step 3.5). It is not the distiller: each
// tool exists to make MosAIc show one behaviour that the design relies on. Started as
// `node quirk-server.mjs <name>`; the name is the server's own name and is shown by `whoami`.
//
//   sleep {ms}          answers after `ms` milliseconds (QRK-1)
//   image               a text block, then an image block (QRK-2)
//   pay_first           one text block that is exactly a payment signal (the control of QRK-3)
//   pay_second_block    a harmless first text block, then the signal in the second (QRK-3)
//   pay_after_prose     one text block: prose, then the signal (QRK-3)
//   pay_false           one text block: the signal key set to false (QRK-3)
//   env {name}          the value of that environment variable in this process (QRK-4)
//   echo                the arguments object this server received, as JSON (QRK-5, QRK-7)
//   whoami              this server's name
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const name = process.argv[2] ?? "quirk";
const SIGNAL = { __payment_required: true, amount: 1, currency: "TEST" };
const anything = { type: "object", additionalProperties: true };
const tools = [
  ["sleep", "Answers after a delay"],
  ["image", "Returns text and an image"],
  ["pay_first", "A payment signal as the first block"],
  ["pay_second_block", "A payment signal in the second block"],
  ["pay_after_prose", "Prose, then a payment signal"],
  ["pay_false", "The payment key set to false"],
  ["env", "Reads an environment variable"],
  ["echo", "Returns the arguments it received"],
  ["whoami", "Returns this server's name"],
].map(([toolName, description]) => ({
  name: toolName,
  description: `${description} (${name})`,
  inputSchema: anything,
}));

const server = new Server({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments;
  const text = (t) => ({ type: "text", text: t });
  switch (request.params.name) {
    case "sleep":
      await new Promise((r) => setTimeout(r, Number(args?.ms ?? 0)));
      return { content: [text("slept")] };
    case "image":
      // A 1x1 transparent PNG.
      return {
        content: [
          text("text block"),
          {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          },
        ],
      };
    case "pay_first":
      return { content: [text(JSON.stringify(SIGNAL))] };
    case "pay_second_block":
      return { content: [text("harmless first block"), text(JSON.stringify(SIGNAL))] };
    case "pay_after_prose":
      return { content: [text(`Note before the data: ${JSON.stringify(SIGNAL)}`)] };
    case "pay_false":
      return { content: [text(JSON.stringify({ ...SIGNAL, __payment_required: false }))] };
    case "env":
      return { content: [text(String(process.env[String(args?.name)] ?? "(unset)"))] };
    case "echo":
      return { content: [text(JSON.stringify(args ?? null))] };
    case "whoami":
      return { content: [text(name)] };
    default:
      return { isError: true, content: [text(`unknown tool ${request.params.name}`)] };
  }
});
await server.connect(new StdioServerTransport());
