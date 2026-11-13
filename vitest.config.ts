// Vitest configuration: which files hold tests, and the default time limit of one test.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    // Leave cores free for the main process: several test files run synchronous work for seconds,
    // and a starved main process makes vitest's own worker calls time out.
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
