// QRK-3: how a payment signal is detected in a tool result (`electron/addons/api/mcp.ts:17-71`;
// `src/services/ActionParser.ts:132-139`). A result whose first text block is JSON with
// `__payment_required` set opens the payment screen, on the chat path and on the add-on path. The
// signal in the second block, after prose, or set to false is not detected. The control, a signal
// in the first block, proves the screen does open in this build. Our neutralisation (§4.5) is then
// confirmed to defeat detection: the distiller, given the signal, returns no signal.
import { expect, quirkEntry, test } from "../fixtures";
import { S } from "../selectors";

test.use({ extraPlugins: { entries: [quirkEntry("quirk")] } });

const raw = {
  pay_second_block: "harmless first block",
  pay_after_prose: "Note before the data:",
  pay_false: '"__payment_required":false',
};
const NOT_DETECTED = Object.keys(raw) as Array<keyof typeof raw>;
const SIGNAL_TEXT = JSON.stringify({ __payment_required: true, amount: 1, currency: "TEST" });

test.describe("on the add-on path", () => {
  test("QRK-3 control: a signal in the first block opens the payment screen", async ({
    mosaic,
  }) => {
    const addon = await mosaic.loadTestAddon();
    void addon.call("quirk", "pay_first", {}, 5_000).catch(() => undefined);
    await expect(mosaic.page.locator(S.paymentModal)).toBeVisible({ timeout: 15_000 });
  });

  for (const tool of NOT_DETECTED) {
    test(`QRK-3 ${tool} is not detected: the result arrives as it is, and no screen opens`, async ({
      mosaic,
    }) => {
      const addon = await mosaic.loadTestAddon();
      const r = await addon.call("quirk", tool, {});
      expect(r.ok).toBe(true);
      expect(JSON.stringify(r)).toContain(raw[tool].replace(/"/g, '\\"'));
      await expect(mosaic.page.locator(S.paymentModal)).toHaveCount(0);
    });
  }

  test("QRK-3 our neutralisation: the distiller, given the signal, returns no signal and no screen opens", async ({
    mosaic,
  }) => {
    const addon = await mosaic.loadTestAddon();
    const r = await addon.call("distiller", "distill", { text: `before ${SIGNAL_TEXT} after` });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("__payment_required");
    await mosaic.page.waitForTimeout(1500);
    await expect(mosaic.page.locator(S.paymentModal)).toHaveCount(0);
  });
});

test.describe("on the chat path", () => {
  test("QRK-3 control: a signal in the first block opens the payment screen", async ({
    mosaic,
  }) => {
    mosaic.model.load(['<use_tool server="quirk" tool="pay_first">{}</use_tool>', "ok"]);
    await mosaic.addAgent("agent-1", "Agent One");
    await mosaic.startChat("go");
    await expect(mosaic.page.locator(S.paymentModal)).toBeVisible({ timeout: 15_000 });
  });

  for (const tool of NOT_DETECTED) {
    test(`QRK-3 ${tool} is not detected: the agent is given the result, and no screen opens`, async ({
      mosaic,
    }) => {
      mosaic.model.load([`<use_tool server="quirk" tool="${tool}">{}</use_tool>`, "ok"]);
      await mosaic.addAgent("agent-1", "Agent One");
      await mosaic.startChat("go");
      await mosaic.model.waitForChats(2);
      expect(mosaic.model.chatRequests()[1]?.lastMessage).toContain(
        `[Tool Output for quirk:${tool}]`,
      );
      // The agent is given the first block's text only (QRK-2), so a signal in the second block
      // is not in what it receives; the other two are.
      expect(mosaic.model.chatRequests()[1]?.lastMessage).toContain(
        tool === "pay_second_block" ? "harmless first block" : "__payment_required",
      );
      await mosaic.page.waitForTimeout(1500);
      await expect(mosaic.page.locator(S.paymentModal)).toHaveCount(0);
    });
  }

  test("QRK-3 our neutralisation: the distiller, given the signal, returns no signal and no screen opens", async ({
    mosaic,
  }) => {
    const args = JSON.stringify({ text: `before ${SIGNAL_TEXT} after` });
    mosaic.model.load([`<use_tool server="distiller" tool="distill">${args}</use_tool>`, "ok"]);
    await mosaic.addAgent("agent-1", "Agent One");
    await mosaic.startChat("go");
    await mosaic.model.waitForChats(2);
    expect(mosaic.model.chatRequests()[1]?.lastMessage).not.toContain("__payment_required");
    await mosaic.page.waitForTimeout(1500);
    await expect(mosaic.page.locator(S.paymentModal)).toHaveCount(0);
  });
});
