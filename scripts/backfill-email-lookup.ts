/**
 * One-shot: fill User.emailLookup and re-encrypt email with random IV.
 * Run after migration 20260713090000_user_email_lookup:
 *   npx tsx scripts/backfill-email-lookup.ts
 */
import { PrismaClient } from "@prisma/client";
import { decrypt, encrypt, emailLookupHash, isEncrypted } from "../lib/encryption";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, emailLookup: true },
  });
  let updated = 0;
  for (const user of users) {
    let plain = user.email;
    if (isEncrypted(user.email)) {
      try {
        plain = decrypt(user.email);
      } catch {
        console.warn("skip decrypt fail", user.id);
        continue;
      }
    }
    const lookup = emailLookupHash(plain);
    await prisma.$executeRaw`
      UPDATE "User"
      SET "email" = ${encrypt(plain)}, "emailLookup" = ${lookup}
      WHERE "id" = ${user.id}
    `;
    updated += 1;
  }
  console.log(`scanned=${users.length} updated=${updated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
