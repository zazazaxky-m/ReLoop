import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/lib/audit";
import { isLegacyAcceptanceMarker } from "@/lib/deposit-review-contract";
import { collectWalletInventory } from "@/scripts/reconcile-wallet-history";
import { f } from "../support/audit-fixture";
import { auditEnvironment, resetDisposableDatabase } from "../support/disposable-db";

const ROOT = path.resolve(__dirname, "../..");

/**
 * M04 fix round 4 (N2d): the demo seed must produce rows the acceptance
 * contract produces, never the legacy shape (ACCEPTED or post-acceptance REVIEW
 * items without an acceptance event, time and recorded rate; keyless EARNs).
 * The seed runs for real against the runner-owned database; the fixture
 * truncates it again afterwards.
 */
describe("prisma/seed.ts follows the acceptance contract (M04 fix round 4)", () => {
  it("seeds accepted and held demo items with their acceptance event, time, rate and keyed earning", async () => {
    const env = auditEnvironment();
    await resetDisposableDatabase(f.db, env.databaseUrl, env.runId);
    const seed = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["prisma/seed.ts"], {
      cwd: ROOT, env: process.env, encoding: "utf8", timeout: 240_000,
    });
    expect(seed.status, `${seed.stderr}\n${seed.stdout.slice(-2000)}`).toBe(0);

    const items = await f.db.depositItem.findMany({
      where: { status: { in: ["ACCEPTED", "REVIEW"] } },
      include: { ledgerEntries: { where: { entryType: "EARN" } } },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.status === "REVIEW")).toBe(true);
    for (const item of items) {
      const label = `${item.status} item ${item.id}`;
      expect(item.acceptanceEventId, label).not.toBeNull();
      expect(isLegacyAcceptanceMarker(item.acceptanceEventId), label).toBe(false);
      expect(item.acceptedAt, label).not.toBeNull();
      expect(item.rewardRateId, label).not.toBeNull();
      const event = await f.db.machineEvent.findUnique({ where: { id: item.acceptanceEventId! } });
      expect(event, label).toMatchObject({ eventType: "ITEM_ACCEPTED_POINT", depositItemId: item.id, sessionId: item.sessionId });
      for (const earn of item.ledgerEntries) {
        expect(earn.businessKey, label).toBe(`deposit-item:${item.id}:earn`);
        expect(earn.status, label).toBe(item.status === "REVIEW" ? "PENDING" : "AVAILABLE");
      }
      if (item.status === "REVIEW") {
        expect(item.ledgerEntries, label).toHaveLength(1);
        const rate = await f.db.rewardRate.findUniqueOrThrow({ where: { id: item.rewardRateId! } });
        expect(rate.effectiveFrom.getTime(), label).toBeLessThanOrEqual(item.acceptedAt!.getTime());
        expect(rate.effectiveTo === null || rate.effectiveTo.getTime() > item.acceptedAt!.getTime(), label).toBe(true);
      }
    }

    const inventory = await f.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectWalletInventory(tx);
    }, { isolationLevel: "RepeatableRead" });
    expect(inventory.reviewItemsWithoutAcceptance).toEqual([]);
    expect(inventory.acceptedItemsWithoutAcceptance).toEqual([]);
    expect(inventory.reviewItemsWithRateOutsideAcceptance).toEqual([]);
    expect(inventory.rejectedItemsWithMoney).toEqual([]);
    expect(inventory.summary.blocksEnforcement).toBe(0);

    // A05: the demo audit history goes through the production writer, so it is a valid v2 chain.
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedVersion: 2, legacyStatus: "not-present" });
    expect((await verifyAuditChain()).checkedCount).toBe(await f.db.auditLog.count());
  });
});
