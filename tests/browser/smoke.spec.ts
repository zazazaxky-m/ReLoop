import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support/browser-fixture";

const horizontalOverflow = () => document.documentElement.scrollWidth - window.innerWidth;

test("login page renders in both themes without horizontal overflow", async ({ page, artifacts }, testInfo) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Masuk ke ReLoop" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();

  const dark = testInfo.project.use.colorScheme === "dark";
  await expect(page.locator("html")).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical").map((v) => v.id)).toEqual([]);

  await artifacts.screenshot(page, "login");
});

test("a fixture session opens the user dashboard on the real server", async ({ page, fixture, artifacts }) => {
  await fixture.audit.seedBalance(25_000);
  await fixture.login(page, "userA");
  await page.goto("/dashboard/user");
  await expect(page).toHaveURL(/\/dashboard\/user$/);
  await expect(page.getByRole("heading", { name: "Halo, Pengguna!" })).toBeVisible();
  // The balance seeded in the shared test database is what the real server renders.
  await expect(page.getByText(/Rp\s25\.000/).first()).toBeVisible();
  expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(0);
  await artifacts.screenshot(page, "dashboard-user");
});
