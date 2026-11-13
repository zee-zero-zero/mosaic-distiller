// MOS-4: a misbehaving model does no harm (§5.8). The fake model emits, in turn, a wrong server
// name, arguments as a string, prose inside the arguments, two tool tags, a truncated tag and
// arguments holding the payment key. In every case our server stays up, no payment screen opens,
// and the outcome is recorded: what MosAIc sent back to the model, attached to the test.
import { expect, test, type Mosaic } from "../fixtures";
import { S } from "../selectors";

const OPEN = '<use_tool server="distiller" tool="distill">';
const PAYMENT = '{"__payment_required": true, "amount": 1}';

interface Case {
  name: string;
  reply: string;
  /** How many requests the chat sends to the model: 2 when MosAIc ran a tool, 1 when it did not. */
  chats: 1 | 2;
  /** What MosAIc handed back to the model as the tool's output (checked when `chats` is 2). */
  output?: (text: string) => void;
}

const cases: Case[] = [
  {
    name: "a wrong server name",
    reply: '<use_tool server="no-such-server" tool="distill">{"text":"a"}</use_tool>',
    chats: 2,
    output: (t) => expect(t).toMatch(/Error calling tool distill/),
  },
  {
    name: "arguments as a string",
    reply: `${OPEN}"jane.doe@northwind-mail.com"</use_tool>`,
    chats: 2,
    output: (t) => {
      expect(t).not.toContain("person1@example.com"); // nothing ran on the string
    },
  },
  {
    name: "prose inside the arguments",
    reply: `${OPEN}Please clean jane.doe@northwind-mail.com for me</use_tool>`,
    chats: 2,
    output: (t) => expect(t).not.toContain("person1@example.com"),
  },
  {
    name: "two tool tags",
    reply:
      `${OPEN}{"text":"one jane.doe@northwind-mail.com"}</use_tool> and ` +
      `${OPEN}{"text":"two john.roe@northwind-mail.com"}</use_tool>`,
    chats: 2,
    output: (t) => expect(t).toContain("one person1@example.com"),
  },
  {
    name: "a truncated tag",
    reply: `Cleaning. ${OPEN}{"text":"jane.doe@northwind-mail.com"}`,
    chats: 1,
  },
  {
    name: "arguments holding the payment key",
    reply: `${OPEN}${JSON.stringify({ text: `before ${PAYMENT} after` })}</use_tool>`,
    chats: 2,
    output: (t) => {
      // The engine's own rule catches the key first (`inject.consumer_markup`); the server's
      // outbound layer is the second line, and the segment-id case below reaches only that one.
      expect(t).toContain("[neutralised: ");
      expect(t).not.toContain("__payment_required");
    },
  },
  {
    name: "a segment id that is the payment key",
    reply: `${OPEN}${JSON.stringify({ segments: [{ id: "__payment_required", text: "x" }] })}</use_tool>`,
    chats: 2,
    output: (t) => expect(t).not.toContain("__payment_required"),
  },
];

async function stillUp(mosaic: Mosaic) {
  const listed = (await mosaic.page.evaluate(() =>
    (window as any).electronAPI.mcpAPI.listServers(),
  )) as Array<{
    name: string;
    initialized: boolean;
  }>;
  expect(listed.find((s) => s.name === "distiller")?.initialized).toBe(true);
  const r = await mosaic.callTool("distiller", "distill", {
    text: "again jane.doe@northwind-mail.com",
  });
  expect(r.success).toBe(true);
  expect(JSON.stringify(r.result)).toContain("again person1@example.com");
}

for (const c of cases) {
  test(`MOS-4 ${c.name}: the server stays up and no payment screen opens`, async ({
    mosaic,
  }, testInfo) => {
    mosaic.model.load([c.reply, "Done."]);
    await mosaic.addAgent("agent-1", "Agent One");
    await mosaic.startChat("clean this");
    await mosaic.model.waitForChats(c.chats);
    await mosaic.page.waitForTimeout(2500); // time for a payment screen to open, if one would
    const chats = mosaic.model.chatRequests();
    expect(chats.length).toBe(c.chats);
    const output = chats[1]?.lastMessage ?? "";
    if (c.output) c.output(output);
    await expect(mosaic.page.locator(S.paymentModal)).toHaveCount(0);
    await stillUp(mosaic);
    await testInfo.attach("outcome", {
      contentType: "application/json",
      body: JSON.stringify(
        { case: c.name, chats: chats.length, toolOutput: output.slice(0, 600) },
        null,
        2,
      ),
    });
  });
}
