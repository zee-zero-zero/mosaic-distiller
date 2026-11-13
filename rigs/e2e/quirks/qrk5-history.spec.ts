// QRK-5: chat history keeps tool arguments and results (`src/components/Chatview.tsx:666-853`). A
// `distill` call from a chat leaves the stored session holding the arguments, which contain the
// original text. This is why the README says that when a chat agent calls the distiller, the
// original text is already in that chat (§6.5).
import { expect, test } from "../fixtures";

const ORIGINAL = "Write to jane.doe@northwind-mail.com.";

test("QRK-5 the stored chat session holds the call's arguments, with the original text", async ({
  mosaic,
}) => {
  const args = JSON.stringify({ text: ORIGINAL });
  mosaic.model.load([
    `Cleaning it. <use_tool server="distiller" tool="distill">${args}</use_tool>`,
    "Done.",
  ]);
  await mosaic.addAgent("agent-1", "Agent One");
  await mosaic.startChat("Please clean this before sharing.");
  await mosaic.model.waitForChats(2);
  await mosaic.page.waitForTimeout(1500); // the session is saved after the last reply
  const sessions = (await mosaic.page.evaluate(() =>
    (window as any).electronAPI.aiAgentsHistory.getAll("agent-1"),
  )) as Array<{
    messages: Array<{ role: string; content: string }>;
  }>;
  const stored = JSON.stringify(sessions);
  expect(sessions.length).toBe(1);
  expect(stored).toContain("jane.doe@northwind-mail.com"); // in the stored arguments
  expect(stored).toContain("person1@example.com"); // and the stored result
});
