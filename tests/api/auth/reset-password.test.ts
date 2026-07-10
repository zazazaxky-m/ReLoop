import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/reset-password/route";
import { prisma } from "@/lib/prisma";
import * as auth from "@/lib/auth";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";
import * as passwordReset from "@/lib/password-reset";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/password-reset", () => ({
  consumePasswordResetToken: vi.fn(),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as never);
    vi.mocked(auth.hashPassword).mockResolvedValue("new-hash");
  });

  it("updates password when token is valid", async () => {
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue(
      "user-1",
    );

    const res = await POST(
      makeRequest({ token: "valid-token", password: "secret123456" }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(auth.hashPassword).toHaveBeenCalledWith("secret123456");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: "new-hash",
        tokenVersion: { increment: 1 },
      },
    });
    expect(auth.clearSessionCookie).toHaveBeenCalled();
    expect(audit.logAudit).toHaveBeenCalled();
    expect(data.message).toMatch(/berhasil/i);
  });

  it("rejects invalid or expired tokens", async () => {
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ token: "bad-token", password: "secret123456" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects when rate limited", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: false } as never);

    const res = await POST(
      makeRequest({ token: "token", password: "secret123456" }),
    );
    expect(res.status).toBe(429);
  });

  it("returns handled error when update throws", async () => {
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue("user-1");
    vi.mocked(prisma.user.update).mockRejectedValue(new Error("update boom"));
    expect(
      (await POST(makeRequest({ token: "valid-token", password: "secret123456" }))).status,
    ).toBe(500);
  });
});
