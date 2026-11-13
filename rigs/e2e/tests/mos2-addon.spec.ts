// MOS-2: a test add-on with the `mcp:call` permission, loaded through MosAIc's Dev corner, calls
// `distill` and the result arrives (§5.8).
import { expect, test } from "../fixtures";

test("MOS-2 an add-on with mcp:call calls distill and the result arrives", async ({ mosaic }) => {
  const addon = await mosaic.loadTestAddon();
  const r = await addon.call("distiller", "distill", {
    text: "Write to jane.doe@northwind-mail.com.",
  });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const text = r.result.content?.[0]?.text ?? "";
  expect(text).toContain("Write to person1@example.com.");
  expect(text).not.toContain("northwind-mail");
});

test("MOS-2 the add-on can also list the server's tools, and a missing server is an error, not a crash", async ({
  mosaic,
}) => {
  const addon = await mosaic.loadTestAddon();
  const missing = await addon.call("no-such-server", "distill", { text: "a" });
  expect(missing.ok).toBe(false);
  const again = await addon.call("distiller", "capabilities", {});
  expect(again.ok).toBe(true);
});
