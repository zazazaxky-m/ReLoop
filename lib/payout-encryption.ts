import { PrismaClient } from "@prisma/client";
import { encrypt, isEncrypted } from "./encryption";

export interface PayoutEncryptionBackfillResult {
  scanned: number;
  updated: number;
}

/** Encrypts legacy plaintext payout account fields in place. */
export async function backfillPayoutEncryption(
  client: Pick<PrismaClient["payoutAccount"], "findMany" | "update"> = new PrismaClient().payoutAccount,
): Promise<PayoutEncryptionBackfillResult> {
  const accounts = await client.findMany({
    select: { id: true, accountIdentifier: true, accountName: true },
  });

  let updated = 0;
  for (const account of accounts) {
    const data: { accountIdentifier?: string; accountName?: string } = {};

    if (account.accountIdentifier && !isEncrypted(account.accountIdentifier)) {
      data.accountIdentifier = encrypt(account.accountIdentifier);
    }
    if (account.accountName && !isEncrypted(account.accountName)) {
      data.accountName = encrypt(account.accountName);
    }

    if (Object.keys(data).length === 0) continue;

    await client.update({ where: { id: account.id }, data });
    updated += 1;
  }

  return { scanned: accounts.length, updated };
}
