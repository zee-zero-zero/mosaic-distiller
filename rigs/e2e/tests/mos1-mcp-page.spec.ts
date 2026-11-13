// MOS-1: the MCP page lists `distiller`, installed by the real installer, and a call from the page
// shows the distillate (§5.8).
import { expect, test } from "../fixtures";
import { S } from "../selectors";

test("MOS-1 the MCP page lists distiller with its two tools and a call renders the distillate", async ({
  mosaic,
}) => {
  const { page } = mosaic;
  await mosaic.openMcpPage();
  await expect(page.locator(S.pluginCard("distiller"))).toBeVisible();
  await page.locator(S.pluginCard("distiller")).click();
  await expect(page.locator(S.toolButton("distill"))).toBeVisible();
  await expect(page.locator(S.toolButton("capabilities"))).toBeVisible();

  await page.locator(S.toolButton("distill")).click();
  await page
    .locator(S.toolArguments)
    .fill(JSON.stringify({ text: "Write to jane.doe@northwind-mail.com." }));
  await page.locator(S.runTool).click();
  const shown = page.locator(S.toolResult);
  await expect(shown).toBeVisible();
  const text = await shown.innerText();
  expect(text).toContain("Write to person1@example.com.");
  expect(text).not.toContain("northwind-mail");
});

test("MOS-1 the installer's output and the first-run screens are on record", async ({ mosaic }) => {
  expect(mosaic.installerOutput).toContain('Added the "distiller" entry');
  expect(mosaic.firstRun.length).toBeGreaterThan(0);
});
