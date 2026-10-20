import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPasswordResetToken, consumePasswordResetToken, findPasswordResetTokenOwner } from "./password-reset";
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

  it("returns null when claim race loses (updateMany count 0)", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      tokenHash: "hash",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as any);
    vi.mocked(prisma.passwordResetToken.updateMany).mockResolvedValue({ count: 0 } as any);

    const userId = await consumePasswordResetToken("raced-token");
    expect(userId).toBeNull();
  });
});

describe("findPasswordResetTokenOwner", () => {
  const record = (overrides: Record<string, unknown> = {}) => ({
    id: "tok_1", userId: "user_1", tokenHash: "hash", usedAt: null,
    expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), ...overrides,
  });

  it("returns the owner of a valid token without claiming it", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue(record() as any);
    await expect(findPasswordResetTokenOwner("raw")).resolves.toBe("user_1");
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it("returns null for unknown, used or expired tokens", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce(null);
    await expect(findPasswordResetTokenOwner("raw")).resolves.toBeNull();
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce(record({ usedAt: new Date() }) as any);
    await expect(findPasswordResetTokenOwner("raw")).resolves.toBeNull();
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValueOnce(record({ expiresAt: new Date(Date.now() - 1) }) as any);
    await expect(findPasswordResetTokenOwner("raw")).resolves.toBeNull();
  });
});

describe("consumePasswordResetToken with a transaction client", () => {
  it("reads and claims through the given client, so the claim rolls back with its transaction", async () => {
    const client = { passwordResetToken: { findUnique: vi.fn(), updateMany: vi.fn() } };
    client.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1", userId: "user_1", tokenHash: "hash", usedAt: null,
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    });
    client.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(consumePasswordResetToken("raw", client as any)).resolves.toBe("user_1");
    expect(client.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: "tok_1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });
});
