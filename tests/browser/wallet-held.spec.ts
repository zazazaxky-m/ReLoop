import { expect, test } from "../support/browser-fixture";

test("the wallet shows money held by an open reconciliation case apart from what can be withdrawn", async ({ page, fixture }) => {
  await fixture.audit.seedBalance(25_000);
  await fixture.audit.db.rewardReconciliationCase.create({ data: {
    businessKey: "review:wallet-held:decision:v1", userId: fixture.audit.ids.userA, depositItemId: null, amount: 5_000,
    entryType: "ADJUST", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });
  await fixture.login(page, "userA");
  await page.goto("/dashboard/user/wallet");

  await expect(page.getByText(/Rp\s?5\.000 dari saldo tersedia sedang ditahan untuk pemeriksaan/)).toBeVisible();
  const amount = page.getByLabel(/Jumlah \(Rp\)/);
  await expect(amount).toHaveAttribute("max", "20000");
  await expect(page.getByText(/Maks Rp\s?20\.000/)).toBeVisible();
});
