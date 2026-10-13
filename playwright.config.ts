import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser specs share one disposable database and Next dev server, so they
// run serially. Start them with `npm run test:browser` (the audit runner sets
// AUDIT_BASE_URL and AUDIT_ARTIFACT_DIR). Traces, videos, HAR and storage
// state stay off: they would capture cookies/JWTs. Screenshots only.
const artifactDir = process.env.AUDIT_ARTIFACT_DIR ?? path.join("test-results", "audit", "browser-local");
const viewports = [
  { name: "mobile-360", width: 360, height: 780 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
];
const schemes = ["light", "dark"] as const;

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactDir, "playwright-output"),
  reporter: [["list"]],
  use: {
    baseURL: process.env.AUDIT_BASE_URL,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
  },
  projects: viewports.flatMap((viewport) => schemes.map((colorScheme) => ({
    name: `${viewport.name}-${colorScheme}`,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme,
    },
  }))),
});
