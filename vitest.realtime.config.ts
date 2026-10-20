import { defineConfig } from "vitest/config";
import path from "node:path";

// Realtime gateway suite (child-process gateway + fake live verifier) on the
// disposable test database. Run through `npm run test:realtime`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/realtime/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/support/audit-fixture.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
