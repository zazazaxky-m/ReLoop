import { prisma } from "./prisma";
import type { AppRole } from "./roles";

/**
 * Internal live verifier contract (R04): everything the realtime gateway may
 * trust about one socket. `POST /api/internal/ws-session` answers this object
 * or `null`; there is no partial or legacy `{ role }` answer.
 */
export interface WsSessionIdentity {
  userId: string;
  role: AppRole;
  organizationId: string | null;
  tokenVersion: number;
  /** Verified session `exp`, Unix seconds; the gateway closes the socket then. */
  expiresAt: number;
}

/** Claims taken from a session JWT that already passed `verifySessionToken`. */
export interface VerifiedSessionClaims {
  sub: string;
  tokenVersion: number;
  expiresAt: number;
}

/**
 * Live DB guard behind the websocket verifier: the session must be unexpired
 * at `nowMs`, the account ACTIVE and its tokenVersion current. Role and
 * organization always come from the database row, never from the token, so
 * suspension, a tokenVersion bump, a role downgrade or an organization move
 * show up on the gateway's next revalidation.
 */
export async function resolveWsSessionIdentity(
  claims: VerifiedSessionClaims,
  nowMs: number = Date.now(),
): Promise<WsSessionIdentity | null> {
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt * 1000 <= nowMs) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { role: true, status: true, tokenVersion: true, organizationId: true },
  });
  if (!user || user.status !== "ACTIVE") return null;
  if (
    !Number.isSafeInteger(claims.tokenVersion) ||
    !Number.isSafeInteger(user.tokenVersion) ||
    claims.tokenVersion !== user.tokenVersion
  ) {
    return null;
  }

  return {
    userId: claims.sub,
    role: user.role as AppRole,
    organizationId: user.organizationId,
    tokenVersion: user.tokenVersion,
    expiresAt: claims.expiresAt,
  };
}
