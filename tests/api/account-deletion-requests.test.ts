import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/account-deletion-requests/route";
import * as erasure from "@/lib/erasure-jobs";
import * as mailer from "@/lib/mailer";
import * as rateLimit from "@/lib/rate-limit";

// Work the route hands to `after()` runs only when the test drains it, which
// is how these tests prove it never sits on the response path.
const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => unknown> }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((task: unknown) => {
      deferred.push(typeof task === "function" ? (task as () => unknown) : () => task);
    }),
  };
});

vi.mock("@/lib/erasure-jobs", () => ({ createPublicDeletionRequest: vi.fn() }));
vi.mock("@/lib/mailer", () => ({ sendAccountDeletionVerificationEmail: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const KNOWN = "pemilik@example.test";
const UNKNOWN = "bukan-akun@example.test";

function request(email: string, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/account-deletion-requests`, {
    method: "POST",
    headers: { "content-type": "application/json", host: new URL(origin).host },
    body: JSON.stringify({ email }),
  });
}

/** Fails instead of hanging when the route waits on something it must not. */
async function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`response waited more than ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function drainDeferred() {
  for (const task of deferred.splice(0)) await task();
}

describe("POST /api/account-deletion-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferred.length = 0;
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://app.reloop.test");
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(erasure.createPublicDeletionRequest).mockImplementation(async ({ email }) => ({
      requestId: `req-${email}`,
      verification: email === KNOWN ? { to: email, token: "tok_abcdefghijklmnopqrstuvwxyz" } : null,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers immediately and identically for known and unknown emails while the mail is still pending", async () => {
    vi.mocked(mailer.sendAccountDeletionVerificationEmail).mockReturnValue(new Promise(() => {})); // never settles

    const known = await within(POST(request(KNOWN)));
    const unknown = await within(POST(request(UNKNOWN)));
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const { requestId: _a, ...knownBody } = await known.json();
    const { requestId: _b, ...unknownBody } = await unknown.json();
    expect(knownBody).toEqual(unknownBody);
    expect(mailer.sendAccountDeletionVerificationEmail).not.toHaveBeenCalled();

    void drainDeferred(); // the mail goes out after the response
    await vi.waitFor(() => expect(mailer.sendAccountDeletionVerificationEmail).toHaveBeenCalledTimes(1));
  });

  it("a failing mail send changes neither the answer nor the outcome", async () => {
    vi.mocked(mailer.sendAccountDeletionVerificationEmail).mockRejectedValue(new Error(`smtp down for ${KNOWN}`));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await within(POST(request(KNOWN)));
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("PENDING");
    await expect(drainDeferred()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(KNOWN);
  });

  it("builds the confirmation link from the configured base URL, never from the request Host", async () => {
    vi.mocked(mailer.sendAccountDeletionVerificationEmail).mockResolvedValue({ sent: true, provider: "test-capture" });

    await within(POST(request(KNOWN, "http://attacker.example")));
    await drainDeferred();
    const { confirmUrl } = vi.mocked(mailer.sendAccountDeletionVerificationEmail).mock.calls[0][0];
    expect(confirmUrl).toBe("https://app.reloop.test/account-deletion/confirm?token=tok_abcdefghijklmnopqrstuvwxyz");
  });

  it("fails closed in production when no base URL is configured: no request, no mail", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await within(POST(request(KNOWN, "http://attacker.example")));
    expect(res.status).toBe(503);
    await drainDeferred();
    expect(erasure.createPublicDeletionRequest).not.toHaveBeenCalled();
    expect(mailer.sendAccountDeletionVerificationEmail).not.toHaveBeenCalled();
  });

  it("outside production without a base URL uses the local default, still never the request Host", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(mailer.sendAccountDeletionVerificationEmail).mockResolvedValue({ sent: false, provider: "log" });

    await within(POST(request(KNOWN, "http://attacker.example")));
    await drainDeferred();
    const { confirmUrl } = vi.mocked(mailer.sendAccountDeletionVerificationEmail).mock.calls[0][0];
    expect(confirmUrl.startsWith("http://localhost:3000/account-deletion/confirm?token=")).toBe(true);
  });

  it("refuses the reserved erased-account domain", async () => {
    const res = await POST(request("erased-abc@invalid.reloop"));
    expect(res.status).toBe(422);
    expect(erasure.createPublicDeletionRequest).not.toHaveBeenCalled();
  });
});
