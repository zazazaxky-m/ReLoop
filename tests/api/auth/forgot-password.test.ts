import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/auth/forgot-password/route";
import { prisma } from "@/lib/prisma";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";
import * as passwordReset from "@/lib/password-reset";
import * as mailer from "@/lib/mailer";
import { NextRequest } from "next/server";

// Work handed to `after()` runs only when the test drains it: this is how the
// tests prove it never sits on the response path.
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/password-reset", () => ({
  createPasswordResetToken: vi.fn(),
}));

vi.mock("@/lib/mailer", () => ({
  sendPasswordResetEmail: vi.fn(),
}));

const ACTIVE = { id: "user-1", status: "ACTIVE", passwordHash: "hash" };

function makeRequest(body: unknown, origin = "http://localhost") {
  return new NextRequest(`${origin}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", host: new URL(origin).host },
    body: JSON.stringify(body),
  });
}

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

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferred.length = 0;
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://app.reloop.test");
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as never);
    vi.mocked(passwordReset.createPasswordResetToken).mockResolvedValue("raw-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns generic success even when email is unknown", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST(makeRequest({ email: "unknown@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toMatch(/terdaftar/i);
    await drainDeferred();
    expect(passwordReset.createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("answers before any per-account work, identically for known and unknown emails", async () => {
    vi.mocked(mailer.sendPasswordResetEmail).mockReturnValue(new Promise(() => {})); // never settles
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(ACTIVE as never).mockResolvedValueOnce(null);

    const known = await within(POST(makeRequest({ email: "user@example.com" })));
    const unknown = await within(POST(makeRequest({ email: "unknown@example.com" })));
    expect(known.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    // Token, mail and audit happen only after the response.
    expect(passwordReset.createPasswordResetToken).not.toHaveBeenCalled();
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();

    void drainDeferred();
    await vi.waitFor(() => expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(1));
    expect(passwordReset.createPasswordResetToken).toHaveBeenCalledWith("user-1");
  });

  it("issues a reset token for active credential users after responding", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE as never);
    vi.mocked(mailer.sendPasswordResetEmail).mockResolvedValue({ sent: false, provider: "log" });

    const res = await POST(makeRequest({ email: "user@example.com" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).not.toHaveProperty("devResetUrl");

    await drainDeferred();
    expect(passwordReset.createPasswordResetToken).toHaveBeenCalledWith("user-1");
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      resetUrl: "https://app.reloop.test/reset-password?token=raw-token",
    });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PASSWORD_RESET_REQUEST" }));
  });

  it("a failing token or mail step changes neither the answer nor the outcome", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE as never);
    vi.mocked(mailer.sendPasswordResetEmail).mockRejectedValue(new Error("resend 500 for user@example.com"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await within(POST(makeRequest({ email: "user@example.com" })));
    expect(res.status).toBe(200);
    await expect(drainDeferred()).resolves.toBeUndefined();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("user@example.com");

    vi.mocked(passwordReset.createPasswordResetToken).mockRejectedValueOnce(new Error("db down"));
    const again = await within(POST(makeRequest({ email: "user@example.com" })));
    expect(again.status).toBe(200);
    await expect(drainDeferred()).resolves.toBeUndefined();
  });

  it("builds the reset link from the configured base URL, never from the request Host", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE as never);
    vi.mocked(mailer.sendPasswordResetEmail).mockResolvedValue({ sent: true, provider: "test-capture" });

    await POST(makeRequest({ email: "user@example.com" }, "http://attacker.example"));
    await drainDeferred();
    const { resetUrl } = vi.mocked(mailer.sendPasswordResetEmail).mock.calls[0][0];
    expect(resetUrl).toBe("https://app.reloop.test/reset-password?token=raw-token");
  });

  it("fails closed in production when no base URL is configured: no lookup, no token, no mail", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest({ email: "user@example.com" }, "http://attacker.example"));
    expect(res.status).toBe(503);
    await drainDeferred();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(passwordReset.createPasswordResetToken).not.toHaveBeenCalled();
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("outside production without a base URL uses the local default, still never the request Host", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE as never);
    vi.mocked(mailer.sendPasswordResetEmail).mockResolvedValue({ sent: false, provider: "log" });

    await POST(makeRequest({ email: "user@example.com" }, "http://attacker.example"));
    await drainDeferred();
    const { resetUrl } = vi.mocked(mailer.sendPasswordResetEmail).mock.calls[0][0];
    expect(resetUrl).toBe("http://localhost:3000/reset-password?token=raw-token");
  });

  it("rejects when rate limited", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: false } as never);

    const res = await POST(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(429);
  });

  it("returns handled error when lookup throws", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("db boom"));
    expect((await POST(makeRequest({ email: "user@example.com" }))).status).toBe(500);
  });
});
