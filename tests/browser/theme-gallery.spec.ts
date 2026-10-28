import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/browser-fixture";

// Before/after gallery for the app-wide editorial theme
// (docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md).
// Every page is screenshotted per viewport and scheme; pages listed in
// RESTYLED must also be free of axe color-contrast violations.

const RESTYLED = new Set<string>([
  "/login",
  "/register",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/dashboard/user",
  "/dashboard/user/wallet",
  "/map",
  "/scan",
  "/dashboard/pengepul",
  "/dashboard/admin",
  "/dashboard/admin/machines",
  "/dashboard/admin/machines/[id]",
  "/dashboard/superadmin",
  "/dashboard/superadmin/users",
  "/dashboard/superadmin/config",
  "/dashboard/superadmin/audit",
]);

// Defects already present on main (7b0361f) before the theme work; they are
// tolerated here so the gallery still catches anything new.
const KNOWN_DEFECTS: Record<string, { overflow?: number; critical?: string[] }> = {
  "/dashboard/superadmin/users": { critical: ["select-name"] },
  "/dashboard/superadmin/config": { critical: ["label"] },
};

const horizontalOverflow = () => document.documentElement.scrollWidth - window.innerWidth;

/** `route` is the path's pattern in RESTYLED and KNOWN_DEFECTS, for a path with a seeded id. */
async function capture(
  page: Page,
  path: string,
  slug: string,
  screenshot: (page: Page, name: string) => Promise<string>,
  route = path,
) {
  const known = KNOWN_DEFECTS[route] ?? {};
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible();
  // Measure the settled layout, not the fallback font before DM Sans swaps in.
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(horizontalOverflow)).toBeLessThanOrEqual(known.overflow ?? 0);
  // Metric values never wrap (a split amount reads as another one), so each must fit its card.
  const clipped = await page
    .locator("[data-metric-value]")
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(clipped).toEqual([]);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const critical = axe.violations.filter((v) => v.impact === "critical" && !known.critical?.includes(v.id));
  expect(critical.map((v) => v.id)).toEqual([]);
  if (RESTYLED.has(route)) {
    expect(axe.violations.filter((v) => v.id === "color-contrast").flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
  }

  await screenshot(page, `theme-${slug}`);
}

test("public pages", async ({ page, fixture, artifacts }) => {
  await fixture.login(page, "guest");
  for (const [path, slug] of [
    ["/login", "login"],
    ["/register", "register"],
    ["/forgot-password", "forgot-password"],
    ["/privacy", "privacy"],
    ["/terms", "terms"],
  ] as const) {
    await capture(page, path, slug, artifacts.screenshot);
  }

  // Legacy surface: screenshot only, it must look unchanged.
  await page.goto(`/kiosk/${fixture.audit.ids.machineCode}`);
  await page.waitForLoadState("networkidle");
  await artifacts.screenshot(page, "theme-kiosk");
});

test("user pages", async ({ page, fixture, artifacts }) => {
  // A long Anton balance must still fit a 360px screen.
  await fixture.audit.seedBalance(12_345_678);
  await fixture.machinesForMap();
  await fixture.login(page, "userA");
  for (const [path, slug] of [
    ["/dashboard/user", "dashboard-user"],
    ["/dashboard/user/wallet", "wallet"],
    ["/map", "map"],
    ["/scan", "scan"],
  ] as const) {
    await capture(page, path, slug, artifacts.screenshot);
  }
});

test("collector pages", async ({ page, fixture, artifacts }) => {
  await fixture.login(page, "collectorA");
  await capture(page, "/dashboard/pengepul", "dashboard-pengepul", artifacts.screenshot);
});

test("admin pages", async ({ page, fixture, artifacts }) => {
  const trip = await fixture.audit.trip({ bagCount: 2 });
  await fixture.login(page, "adminA");
  for (const [path, slug] of [
    ["/dashboard/admin", "dashboard-admin"],
    ["/dashboard/admin/machines", "admin-machines"],
  ] as const) {
    await capture(page, path, slug, artifacts.screenshot);
  }
  // Its status metric holds a badge, which must keep the app face (not Anton).
  await capture(
    page,
    `/dashboard/admin/machines/${fixture.audit.ids.machineA}`,
    "admin-machine-detail",
    artifacts.screenshot,
    "/dashboard/admin/machines/[id]",
  );
  const statusBadge = page.locator("[data-metric-value] > span").first();
  expect(await statusBadge.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"DM Sans"/);

  // Legacy surface: screenshot only, it must look unchanged.
  await page.goto(`/print/trips/${trip.id}`);
  await page.waitForLoadState("networkidle");
  await artifacts.screenshot(page, "theme-print");
});

test("superadmin pages", async ({ page, fixture, artifacts }) => {
  await fixture.login(page, "superadmin");
  for (const [path, slug] of [
    ["/dashboard/superadmin", "dashboard-superadmin"],
    ["/dashboard/superadmin/users", "superadmin-users"],
    ["/dashboard/superadmin/config", "superadmin-config"],
    ["/dashboard/superadmin/audit", "superadmin-audit"],
  ] as const) {
    await capture(page, path, slug, artifacts.screenshot);
  }
});

test("landing hero is unchanged", async ({ page }) => {
  // The baseline is recorded locally from main before the theme work and is
  // gitignored, so CI has nothing to compare against.
  test.skip(!!process.env.CI, "landing baseline is local-only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveScreenshot("landing-hero.png", { animations: "disabled" });
});
