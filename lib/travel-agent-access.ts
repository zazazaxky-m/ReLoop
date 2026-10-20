import type { Prisma } from "@prisma/client";

/**
 * A03 (SEC-03): memberships that grant trip access. A membership counts only
 * when it was accepted through an emailed invitation (verifiedAt) by an
 * account whose current email is verified. An email change clears both
 * (lib/invitations.ts clearMailboxProof), so access stops until the account
 * accepts a fresh invitation. Kept dependency-free so trip guards can import
 * it without the invitation service.
 */
export const VERIFIED_MEMBERSHIP = {
  verifiedAt: { not: null },
  user: { emailVerifiedAt: { not: null } },
} satisfies Prisma.TravelAgentUserWhereInput;
