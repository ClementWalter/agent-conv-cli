/** Keep service tests separate from browser suites and measure production behavior. */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["service/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
