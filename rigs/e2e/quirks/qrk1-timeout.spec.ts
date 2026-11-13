// QRK-1: a tool call times out after 60 seconds (MCPClient.ts:369-377; the SDK's default). A test
// server sleeping 61 seconds gives MosAIc's own timeout error. This is why the distiller has its
// own 20-second deadline (SRV-8). It waits a minute, so it runs only in `quirks-mosaic`.
import { expect, quirkEntry, test } from "../fixtures";

test.use({ extraPlugins: { entries: [quirkEntry("quirk")] } });

test("QRK-1 a tool call that takes 61 seconds ends with MosAIc's timeout error, near 60 seconds", async ({
  mosaic,
}) => {
  test.setTimeout(180_000);
  await mosaic.openMcpPage();
  const started = Date.now();
  const r = await mosaic.callTool("quirk", "sleep", { ms: 61_000 });
  const seconds = (Date.now() - started) / 1000;
  expect(r.success).toBe(false);
  expect(String(r.error)).toMatch(/timed out|timeout/i);
  expect(seconds).toBeGreaterThan(55);
  expect(seconds).toBeLessThan(65);
});
