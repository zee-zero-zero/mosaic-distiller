// MOS-3: a one-to-one chat agent, pointed at the fake model, emits a valid tool call, and the
// result reaches the chat (§5.8).
import { expect, test } from "../fixtures";

test("MOS-3 a chat agent's tool call reaches distill and the result reaches the chat", async ({
  mosaic,
}) => {
  const { page, model } = mosaic;
  model.load([
    'Cleaning it. <use_tool server="distiller" tool="distill">{"text":"Write to jane.doe@northwind-mail.com."}</use_tool>',
    "The text is clean.",
  ]);
  await mosaic.addAgent("agent-1", "Agent One");
  await mosaic.startChat("Please clean this before sharing.");
  await model.waitForChats(2);

  // The second request to the model carries the tool's output: the distillate, not the original.
  const second = model.chatRequests()[1];
  const output = second?.lastMessage ?? "";
  expect(output).toContain("[Tool Output for distiller:distill]");
  expect(output).toContain("Write to person1@example.com.");
  expect(output).not.toContain("northwind-mail");

  // The chat shows that the tool ran, and the model's closing reply.
  await expect(page.getByText("Called distiller:distill")).toBeVisible();
  await expect(page.getByText("The text is clean.").first()).toBeVisible();
});
