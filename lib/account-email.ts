import { z } from "zod";

/**
 * Domain of the placeholder address an erased account receives
 * (`erased-<userId>@invalid.reloop`, lib/erasure-jobs.ts). No account may ever
 * be given an address on it: otherwise anyone could pre-register a known
 * user's placeholder and make that user's erasure fail on the unique email
 * lookup forever.
 */
export const ERASED_EMAIL_DOMAIN = "invalid.reloop";

export const RESERVED_EMAIL_MESSAGE = "Alamat email ini tidak dapat digunakan";

export function isReservedEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domain === ERASED_EMAIL_DOMAIN || domain.endsWith(`.${ERASED_EMAIL_DOMAIN}`);
}

/** Email accepted for an account (registration, profile change, admin create). */
export function accountEmailSchema(message = "Email tidak valid") {
  return z.string().email(message).refine((email) => !isReservedEmail(email), RESERVED_EMAIL_MESSAGE);
}
