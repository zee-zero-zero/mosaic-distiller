// QRK-4: the entry's `env` overrides MosAIc's environment (MCPClient.ts:159-165). A variable set
// in both holds the entry's value in the server. The installer's blanking of NODE_OPTIONS and
// NODE_PATH relies on this.
import { expect, quirkEntry, test } from "../fixtures";

test.use({
  extraEnv: { vars: { QRK_TEST: "from-parent" } },
  extraPlugins: { entries: [quirkEntry("quirk", { QRK_TEST: "from-entry" })] },
});

test("QRK-4 a variable set in MosAIc's environment and in the entry holds the entry's value", async ({
  mosaic,
}) => {
  // MosAIc started with QRK_TEST=from-parent in its environment (`extraEnv`); the entry sets it too.
  await mosaic.openMcpPage();
  const r = await mosaic.callTool("quirk", "env", { name: "QRK_TEST" });
  expect(r.result.content[0].text).toBe("from-entry");
});
