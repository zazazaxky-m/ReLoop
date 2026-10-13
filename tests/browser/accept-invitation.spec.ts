import { expect, test } from "../support/browser-fixture";

/**
 * A03 (SEC-03): the emailed invitation link carries its token in the URL
 * fragment. In a real browser the page moves it out of the address bar at
 * once, no request URL or Referer ever carries it, and a signed-out invitee
 * signs in and comes back to accept with the token kept only in this tab.
 */
test("accepting an invitation from the emailed link keeps the token out of URLs and Referer", async ({ page, fixture, artifacts, baseURL }) => {
  const { audit } = fixture;
  // `next dev` reports request.nextUrl as localhost, so proxy.ts's same-origin
  // check refuses a browser POST whose Origin is 127.0.0.1. Browse the same
  // server as localhost, as a deployment browses its configured host.
  const origin = new URL(baseURL ?? process.env.AUDIT_BASE_URL ?? "");
  origin.hostname = "localhost";
  const site = origin.origin;
  const invite = await audit.pendingInvite(audit.credentials("userA").email);
  const leaks: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    const referer = request.headers()["referer"] ?? "";
    if (request.url().includes(invite.token) || referer.includes(invite.token)) leaks.push(`${request.method()} ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await fixture.login(page, "guest");
  await page.goto(`${site}/accept-invitation#token=${invite.token}`);
  await expect(page.getByRole("heading", { name: "Terima undangan" })).toBeVisible();
  // The fragment is gone before the app renders; the token lives only in this tab.
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => sessionStorage.getItem("reloop:link-token:accept-invitation"))).toBe(invite.token);

  // Signed out: sign in, then come back here.
  await page.getByRole("link", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Faccept-invitation$/);
  const { email, password } = audit.credentials("userA");
  await page.getByLabel("Email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^Masuk/ }).click();
  await expect(page).toHaveURL(/\/accept-invitation$/);
  await expect(page.getByText(email)).toBeVisible();

  const accepted = page.waitForResponse((response) => response.url().endsWith("/api/travel-agent-invitations/accept"));
  await page.getByRole("button", { name: "Terima undangan" }).click();
  expect((await accepted).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Undangan diterima" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("reloop:link-token:accept-invitation"))).toBeNull();

  const membership = await audit.db.travelAgentUser.findFirstOrThrow({ where: { travelAgentId: invite.travelAgentId } });
  expect(membership.userId).toBe(audit.ids.userA);
  expect(membership.verifiedAt).toBeInstanceOf(Date);
  expect(leaks).toEqual([]);
  // Dev-server noise unrelated to this page: Next's dev overlay injects inline
  // styles (blocked by the CSP) and the signed-out session probe answers 401.
  const relevant = consoleErrors.filter((text) =>
    !text.startsWith("Applying inline style violates") && !/status of 401 \(Unauthorized\)/.test(text));
  expect(relevant).toEqual([]);
  expect(consoleErrors.join("\n")).not.toContain(invite.token);
  await artifacts.screenshot(page, "accept-invitation-done");
});
