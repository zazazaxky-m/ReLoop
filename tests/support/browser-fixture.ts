/**
 * Playwright entry point for browser specs (tests/browser/*.spec.ts):
 *
 *   import { test, expect } from "../support/browser-fixture";
 *   test("...", async ({ page, fixture }) => { await fixture.login(page, "userA"); ... });
 *
 * `fixture` shares the runner-owned disposable database with the real Next
 * server (fresh graph per test). `artifacts.screenshot` writes only to the
 * run's gitignored artifact directory.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@/lib/auth";
import { createAuditFixture, type ActorKey, type AuditFixture } from "./fixture-core";

export interface BrowserFixture {
  login(page:Page,actor:ActorKey):Promise<void>;
  startDeposit():Promise<void>;
  requestRedemption():Promise<void>;
  machinesForMap():Promise<void>;
}

export interface BrowserArtifacts {
  /** Full-page screenshot saved as screenshots/<name>-<project>.png. */
  screenshot(page: Page, name: string): Promise<string>;
}

async function expectStatus(response: Response, status: number, what: string) {
  if (response.status !== status) {
    throw new Error(`${what}: expected HTTP ${status}, got ${response.status}`);
  }
}

export const test = base.extend<{ fixture: BrowserFixture & { audit: AuditFixture }; artifacts: BrowserArtifacts }>({
  fixture: async ({ baseURL }, provide) => {
    const audit = await createAuditFixture();
    const origin = baseURL ?? process.env.AUDIT_BASE_URL;
    if (!origin) throw new Error("AUDIT_BASE_URL missing; run through npm run test:browser");
    try {
      await provide({
        audit,
        async login(page, actor) {
          const context = page.context();
          await context.clearCookies({ name: SESSION_COOKIE });
          if (actor === "guest") return;
          await context.addCookies([{
            name: SESSION_COOKIE, value: await audit.sessionCookie(actor), url: origin, httpOnly: true, sameSite: "Lax",
          }]);
        },
        async startDeposit() {
          const token = await audit.machineQrToken();
          await expectStatus(await audit.json("userA", "POST", "/api/scan", { machineCode: audit.ids.machineCode, token }),
            201, "POST /api/scan");
        },
        async requestRedemption() {
          await audit.seedBalance(20_000);
          await expectStatus(await audit.json("userA", "POST", "/api/redemptions", {
            amount: 20_000, payoutAccountId: audit.ids.payoutAccountA, idempotencyKey: `audit-browser-${Date.now()}`,
          }), 201, "POST /api/redemptions");
        },
        async machinesForMap() {
          const machine = await audit.db.machine.update({
            where: { id: audit.ids.machineA },
            data: { latitude: -7.6845, longitude: 108.6496 },
            include: { wasteTypes: true },
          });
          const offline = await audit.db.machine.create({
            data: {
              organizationId: audit.ids.orgA, machineCode: "AUDIT-A-02", name: "Mesin Audit A2",
              status: "OFFLINE", latitude: -7.6901, longitude: 108.6551,
            },
          });
          await audit.db.machineWasteType.create({
            data: { machineId: offline.id, wasteTypeId: machine.wasteTypes[0].wasteTypeId, active: true },
          });
        },
      });
    } finally {
      await audit.dispose();
    }
  },
  artifacts: async ({}, provide, testInfo) => {
    const dir = path.join(process.env.AUDIT_ARTIFACT_DIR ?? testInfo.outputDir, "screenshots");
    mkdirSync(dir, { recursive: true });
    await provide({
      async screenshot(page, name) {
        const file = path.join(dir, `${name}-${testInfo.project.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        return file;
      },
    });
  },
});

export { expect };
