import { createHash, randomBytes } from "node:crypto";
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

/**
 * Validates a raw reset token and, if valid, atomically marks it used and
 * returns the owning userId. Returns null when the token is unknown, already
 * used, or expired.
 */
export async function consumePasswordResetToken(
  rawToken: string,
): Promise<string | null> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Guard against a race where two requests submit the same token: only the
  // update that flips usedAt from null wins.
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  return record.userId;
}
