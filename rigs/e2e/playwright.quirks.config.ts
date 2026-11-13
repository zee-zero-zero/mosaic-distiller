// Playwright configuration of the quirk suite, `quirks-mosaic` (§5.8): QRK-1 to QRK-7, one worker.
// QRK-1 waits 61 seconds for MosAIc's own timeout, so its test sets a longer limit.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "quirks",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  expect: { timeout: 10_000 },
});
