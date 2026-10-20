import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/reset-password/route";
import { prisma } from "@/lib/prisma";
import * as auth from "@/lib/auth";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";
import * as passwordReset from "@/lib/password-reset";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => {
  const user = { update: vi.fn() };
  // runWalletTransaction's client: lockUser's SELECT ... FOR NO KEY UPDATE, then the same user mock.
  const tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => [{ id: "user-1" }]), user };
  return { prisma: { user, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } };
});

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
  findPasswordResetTokenOwner: vi.fn(),
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
    vi.mocked(passwordReset.findPasswordResetTokenOwner).mockResolvedValue("user-1");
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue(
      "user-1",
    );

    const res = await POST(
      makeRequest({ token: "valid-token", password: "secret123456" }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(auth.hashPassword).toHaveBeenCalledWith("secret123456");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: "new-hash",
        tokenVersion: { increment: 1 },
        // A reset also discards a pending MFA setup (A02).
        pendingTotpSecret: null,
        pendingTotpExpiresAt: null,
        pendingTotpTokenVersion: null,
      },
    });
    expect(auth.clearSessionCookie).toHaveBeenCalled();
    expect(audit.logAudit).toHaveBeenCalled();
    expect(data.message).toMatch(/berhasil/i);
  });

  it("consumes the token inside the locked transaction, so a failed transaction keeps the link usable", async () => {
    vi.mocked(passwordReset.findPasswordResetTokenOwner).mockResolvedValue("user-1");
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue("user-1");

    expect((await POST(makeRequest({ token: "valid-token", password: "secret123456" }))).status).toBe(200);
    // Called with the transaction client (not the global client), after the User lock.
    const [, client] = vi.mocked(passwordReset.consumePasswordResetToken).mock.calls[0] as unknown as [string, { $queryRaw: { mock: { invocationCallOrder: number[] } } }];
    expect(client).toBeDefined();
    expect(client).not.toBe(prisma);
    expect(client.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(passwordReset.consumePasswordResetToken).mock.invocationCallOrder[0]);

    // Lock contention (503): the claim never ran outside the rolled-back transaction.
    vi.mocked(passwordReset.consumePasswordResetToken).mockClear();
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("lock timeout", { code: "P2010", clientVersion: "6", meta: { code: "55P03" } }),
    );
    expect((await POST(makeRequest({ token: "valid-token", password: "secret123456" }))).status).toBe(503);
    expect(passwordReset.consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("rejects a token claimed by another request between lookup and lock", async () => {
    vi.mocked(passwordReset.findPasswordResetTokenOwner).mockResolvedValue("user-1");
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue(null);

    expect((await POST(makeRequest({ token: "valid-token", password: "secret123456" }))).status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects invalid or expired tokens", async () => {
    vi.mocked(passwordReset.findPasswordResetTokenOwner).mockResolvedValue(null);
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
    vi.mocked(passwordReset.findPasswordResetTokenOwner).mockResolvedValue("user-1");
    vi.mocked(passwordReset.consumePasswordResetToken).mockResolvedValue("user-1");
    vi.mocked(prisma.user.update).mockRejectedValue(new Error("update boom"));
    expect(
      (await POST(makeRequest({ token: "valid-token", password: "secret123456" }))).status,
    ).toBe(500);
  });
});
