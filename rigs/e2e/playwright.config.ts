// Playwright configuration of the end-to-end rig: the MOS cases, one worker, as MosAIc's own.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  expect: { timeout: 10_000 },
});
