// QRK-7: arguments that are not an object become `{}` (`electron/addons/api/mcp.ts:51`). An add-on
// passing a string reaches a server with `{}`; our server refuses `{}` (SRV-7), so the call ends in
// our refusal and not in a run on nothing.
import { expect, quirkEntry, test } from "../fixtures";

test.use({ extraPlugins: { entries: [quirkEntry("quirk")] } });

test("QRK-7 an add-on passing a string gives the quirk server {} , and our server refuses it", async ({
  mosaic,
}) => {
  const addon = await mosaic.loadTestAddon();
  const echoed = await addon.call("quirk", "echo", "just a string");
  expect(echoed.ok && echoed.result.content?.[0]?.text).toBe("{}");

  for (const bad of ["just a string", ["an", "array"], null, 7]) {
    const r = await addon.call("distiller", "distill", bad);
    expect(r.ok, JSON.stringify(bad)).toBe(true);
    if (!r.ok) continue;
    expect(r.result.isError, `${JSON.stringify(bad)} is refused`).toBe(true);
  }
});
