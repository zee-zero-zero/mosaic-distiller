// QRK-2: only text content is shown (MCPClient.ts:503-512). A result with an image block shows
// only the text on the MCP page (the image as a bracketed label, never its data), and a chat agent
// gets only the first text block.
import { expect, quirkEntry, test } from "../fixtures";
import { S } from "../selectors";

test.use({ extraPlugins: { entries: [quirkEntry("quirk")] } });

test("QRK-2 the MCP page shows the text, and the image only as a label", async ({ mosaic }) => {
  const { page } = mosaic;
  await mosaic.openMcpPage();
  await page.locator(S.pluginCard("quirk")).click();
  await page.locator(S.toolButton("image")).click();
  await page.locator(S.runTool).click();
  const shown = await page.locator(S.toolResult).innerText();
  expect(shown).toContain("text block");
  expect(shown).toContain("[Image: image/png]");
  expect(shown).not.toContain("iVBORw0KGgo");
});

test("QRK-2 a chat agent is given the first text block and nothing of the image", async ({
  mosaic,
}) => {
  mosaic.model.load(['<use_tool server="quirk" tool="image">{}</use_tool>', "ok"]);
  await mosaic.addAgent("agent-1", "Agent One");
  await mosaic.startChat("go");
  await mosaic.model.waitForChats(2);
  const out = mosaic.model.chatRequests()[1]?.lastMessage ?? "";
  expect(out).toContain("[Tool Output for quirk:image]\ntext block");
  expect(out).not.toContain("iVBORw0KGgo");
  expect(out).not.toContain("image/png");
});
