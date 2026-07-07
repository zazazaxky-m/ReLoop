import { backfillPayoutEncryption } from "../lib/payout-encryption";

async function main() {
  const result = await backfillPayoutEncryption();
  console.info(
    `[backfill:payout-encryption] scanned=${result.scanned} updated=${result.updated}`,
  );
}

main().catch((error) => {
  console.error("[backfill:payout-encryption] failed", error);
  process.exit(1);
});
