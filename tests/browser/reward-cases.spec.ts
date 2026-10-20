import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support/browser-fixture";

test("a superadmin resolves a reward reconciliation case from the reconciliation page", async ({ page, fixture }) => {
  await fixture.audit.seedBalance(5_000);
  const open = await fixture.audit.db.rewardReconciliationCase.create({ data: {
    businessKey: "review:browser-case:decision:v1", userId: fixture.audit.ids.userA, depositItemId: null, amount: 5_000,
    entryType: "ADJUST", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });
  await fixture.login(page, "superadmin");
  await page.goto("/dashboard/superadmin/reconciliation");
  const row = page.getByRole("row").filter({ hasText: open.businessKey });
  await expect(row).toBeVisible();
  // The operator sees whose money it is and that it is not necessarily paid out.
  await expect(row).toContainText("Debit tidak tertutup saldo");
  await expect(row).not.toContainText("Saldo sudah dicairkan");

  await row.getByRole("button", { name: "Selesaikan" }).click();
  const note = page.getByLabel("Hasil penanganan");
  await expect(note).toBeFocused();
  // What resolving does to the user's money, stated before it is done.
  await expect(row).toContainText(/Rp\s?5\.000 dari saldo pengguna dapat dicairkan/);
  // Too short: the server's message is announced and the case stays open.
  await note.fill("pendek");
  await page.getByRole("button", { name: "Simpan penyelesaian" }).click();
  await expect(row.getByRole("alert")).toContainText("minimal 10 karakter");
  await expect(note).toHaveAttribute("aria-invalid", "true");

  // The new form only: the page's existing scrollable tables are U05's scope.
  const axe = await new AxeBuilder({ page })
    .include('form[aria-label="Selesaikan kasus rekonsiliasi"]').withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);

  await note.fill("Dana dikembalikan pengguna lewat transfer, bukti di tiket FIN-12");
  await page.getByRole("button", { name: "Simpan penyelesaian" }).click();
  await expect(page.getByRole("row").filter({ hasText: open.businessKey })).toHaveCount(0);
  expect((await fixture.audit.db.rewardReconciliationCase.findUniqueOrThrow({ where: { id: open.id } })).status)
    .toBe("RESOLVED");
});
