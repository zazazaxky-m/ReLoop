import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Password reset tokens.
 *
 * A high-entropy random token is generated and handed to the user (via the
 * delivery channel — see the forgot-password route). Only its SHA-256 hash is
 * persisted, so a database leak cannot be replayed to seize accounts. Tokens
 * are single-use and short-lived.
 */

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issues a fresh reset token for a user and invalidates any still-pending
 * tokens they hold (only the newest link should work). Returns the raw token
 * — the caller is responsible for delivering it and must not persist it.
 */
export async function createPasswordResetToken(
  userId: string,
): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({
      where: { userId, usedAt: null },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    }),
  ]);

  return rawToken;
}

type ResetTokenClient = Pick<Prisma.TransactionClient, "passwordResetToken">;

function isUsable(record: { usedAt: Date | null; expiresAt: Date } | null): boolean {
  return Boolean(record && !record.usedAt && record.expiresAt.getTime() >= Date.now());
}

/**
 * Owner of a currently usable token (null when unknown, used or expired),
 * without claiming it. The owner is immutable, so a caller can learn which
 * User row to lock and then claim the token inside that locked transaction.
 */
export async function findPasswordResetTokenOwner(rawToken: string): Promise<string | null> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { userId: true, usedAt: true, expiresAt: true },
  });
  return record && isUsable(record) ? record.userId : null;
}

/**
 * Validates a raw reset token and, if valid, atomically marks it used and
 * returns the owning userId. Returns null when the token is unknown, already
 * used, or expired. Pass the caller's TransactionClient so the claim commits
 * or rolls back with the password change.
 */
export async function consumePasswordResetToken(
  rawToken: string,
  client: ResetTokenClient = prisma,
): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const record = await client.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || !isUsable(record)) {
    return null;
  }

  // Guard against a race where two requests submit the same token: only the
  // update that flips usedAt from null wins.
  const claimed = await client.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return record.userId;
}
