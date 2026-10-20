import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use tokens sent by email for A03 (travel-agent invitations and
 * account email verification).
 *
 * The raw token is 32 random bytes (base64url, 43 characters). It exists only
 * in memory while the mail is built (lib/email-outbox.ts) and in the
 * recipient's mailbox; the database keeps only its SHA-256, separated per
 * purpose so a token of one kind can never match a hash of the other.
 */

export const EMAIL_TOKEN_BYTES = 32;
/** Invitation links stay valid for 24 hours after each delivery. */
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Email-verification links stay valid for 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** A token as accepted by the API: base64url, never an email or free text. */
export const EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function generateEmailToken(): string {
  return randomBytes(EMAIL_TOKEN_BYTES).toString("base64url");
}

function purposeHash(purpose: string, rawToken: string): string {
  return createHash("sha256").update(`reloop-${purpose}-v1:`).update(rawToken).digest("hex");
}

/** Stored in TravelAgentInvite.tokenHash. */
export function hashInviteToken(rawToken: string): string {
  return purposeHash("travel-agent-invite", rawToken);
}

/** Stored in EmailVerificationToken.tokenHash (purpose VERIFY_EMAIL). */
export function hashEmailVerificationToken(rawToken: string): string {
  return purposeHash("verify-email", rawToken);
}

/** Path of the page that accepts an invitation; the token travels in the fragment. */
export const ACCEPT_INVITATION_PATH = "/accept-invitation";
/** Path of the page that verifies the account email; the token travels in the fragment. */
export const VERIFY_EMAIL_PATH = "/verify-email";

/**
 * Emailed link. The token is in the URL fragment, which browsers never send
 * to a server (no access log, no Referer); the page moves it out of the
 * address bar before anything else runs.
 */
export function emailTokenLink(base: string, path: string, rawToken: string): string {
  return `${base}${path}#token=${rawToken}`;
}
