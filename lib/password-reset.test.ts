import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPasswordResetToken, consumePasswordResetToken, RESET_TOKEN_TTL_MS } from "./password-reset";
import { prisma } from "./prisma";

vi.mock("./prisma", () => ({
  prisma: {
    passwordResetToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((promises: any[]) => Promise.all(promises)),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPasswordResetToken", () => {
  it("deletes old tokens and creates a new one, returning a raw token", async () => {
    vi.mocked(prisma.passwordResetToken.deleteMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.passwordResetToken.create).mockResolvedValue({ id: "tok_1" } as any);

    const raw = await createPasswordResetToken("user_1");

    expect(typeof raw).toBe("string");
    expect(raw.length).toBe(64); // 32 bytes hex
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user_1", usedAt: null },
    });
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user_1" }),
    });
  });
});

describe("consumePasswordResetToken", () => {
  it("returns userId for a valid unused token", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);
    vi.mocked(prisma.passwordResetToken.updateMany).mockResolvedValue({ count: 1 } as any);

    const userId = await consumePasswordResetToken("some-raw-token");
    expect(userId).toBe("user_1");
  });

  it("returns null for an unknown token", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue(null);

    const userId = await consumePasswordResetToken("bad-token");
    expect(userId).toBeNull();
  });

  it("returns null for an already-used token", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      tokenHash: "hash",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);

    const userId = await consumePasswordResetToken("used-token");
    expect(userId).toBeNull();
  });

  it("returns null for an expired token", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    } as any);

    const userId = await consumePasswordResetToken("expired-token");
    expect(userId).toBeNull();
  });
});
