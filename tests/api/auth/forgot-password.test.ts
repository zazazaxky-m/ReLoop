import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/forgot-password/route";
import { prisma } from "@/lib/prisma";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";
import * as passwordReset from "@/lib/password-reset";
import * as mailer from "@/lib/mailer";
import { NextRequest } from "next/server";

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

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as never);
  });

  it("returns generic success even when email is unknown", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await POST(makeRequest({ email: "unknown@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toMatch(/terdaftar/i);
    expect(passwordReset.createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("issues a reset token for active credential users", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      status: "ACTIVE",
      passwordHash: "hash",
    } as never);
    vi.mocked(passwordReset.createPasswordResetToken).mockResolvedValue(
      "raw-token",
    );
    vi.mocked(mailer.sendPasswordResetEmail).mockResolvedValue({
      sent: false,
      provider: "log",
    });

    const res = await POST(makeRequest({ email: "user@example.com" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(passwordReset.createPasswordResetToken).toHaveBeenCalledWith("user-1");
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        resetUrl: expect.stringContaining("/reset-password?token=raw-token"),
      }),
    );
    expect(audit.logAudit).toHaveBeenCalled();
    expect(data.devResetUrl).toContain("/reset-password?token=raw-token");
  });

  it("rejects when rate limited", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: false } as never);

    const res = await POST(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(429);
  });
});
