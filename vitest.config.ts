import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Real-service suites run through scripts/run-audit-tests.mjs; browser
    // specs (*.spec.ts) belong to Playwright. Keep `npm test` Docker-free.
    exclude: [
      "node_modules",
      ".next",
      ".pytest_cache",
      "tests/integration/**",
      "tests/realtime/**",
      "tests/browser/**",
      "**/*.spec.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "proxy.ts"],
      exclude: ["**/*.test.ts", "node_modules", ".next", "lib/payout/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
