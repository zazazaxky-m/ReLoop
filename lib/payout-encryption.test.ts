import { describe, expect, it, vi, beforeEach } from "vitest";
import { backfillPayoutEncryption } from "@/lib/payout-encryption";
import { encrypt, isEncrypted } from "@/lib/encryption";

describe("backfillPayoutEncryption", () => {
  const findMany = vi.fn();
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({});
  });

  it("encrypts plaintext payout fields only", async () => {
    findMany.mockResolvedValue([
      { id: "a1", accountIdentifier: "081234567890", accountName: "John" },
      {
        id: "a2",
        accountIdentifier: encrypt("081111111111"),
        accountName: null,
      },
    ]);

    const result = await backfillPayoutEncryption({ findMany, update });

    expect(result).toEqual({ scanned: 2, updated: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: {
        accountIdentifier: expect.any(String),
        accountName: expect.any(String),
      },
    });

    const encryptedIdentifier = update.mock.calls[0][0].data.accountIdentifier;
    expect(isEncrypted(encryptedIdentifier)).toBe(true);
  });

  it("returns zero updated when everything is already encrypted", async () => {
    findMany.mockResolvedValue([
      {
        id: "a1",
        accountIdentifier: encrypt("081234567890"),
        accountName: encrypt("Jane"),
      },
    ]);

    const result = await backfillPayoutEncryption({ findMany, update });
    expect(result).toEqual({ scanned: 1, updated: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
