import { defineConfig } from "vitest/config";
import path from "node:path";

// Real PostgreSQL/Redis/Next suite. Run through `npm run test:integration`,
// which provisions the disposable services and the shared environment.
export default defineConfig({test:{environment:"node",
  include:["tests/integration/**/*.test.ts"],fileParallelism:false,
  setupFiles:["tests/support/audit-fixture.ts"],
  // First requests compile routes in `next dev`; keep generous bounds.
  testTimeout:120_000,hookTimeout:120_000},
  resolve:{alias:{"@":path.resolve(__dirname,".")}}});
