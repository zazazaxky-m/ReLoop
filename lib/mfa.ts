import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getJwtSecret, tokenClaims } from "./auth-tokens";
export { consumeMfaChallenge, MfaChallengeStoreUnavailable } from "./mfa-challenge-store";
import { verifyPassword } from "./auth";
import { lockUser } from "./db-locks";
import { prisma } from "./prisma";
import { decrypt, encrypt, isEncrypted } from "./encryption";
import { HttpError } from "./rbac";
import {
  buildTotpAuthUrl,
  findTotpStep,
  generateTotpSecret,
} from "./totp";
import type { AppRole } from "./roles";
import { runWalletTransaction } from "./wallet-service";

const MFA_CHALLENGE_TTL = "5m";
const PRIVILEGED_ROLES = new Set<AppRole>(["ADMIN", "SUPERADMIN"]);

export function isPrivilegedRole(role: AppRole): boolean {
  return PRIVILEGED_ROLES.has(role);
}

export function requiresMfaAtLogin(role: AppRole, mfaEnabled: boolean): boolean {
  return isPrivilegedRole(role) && mfaEnabled;
}

function readTotpSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (isEncrypted(stored)) {
    try {
      return decrypt(stored);
    } catch {
      return null;
    }
  }
  return stored;
}

export interface MfaSetupProof {
  currentPassword: string;
  currentCode?: string;
}

export interface MfaSetupStarted {
  secret: string;
  otpauthUrl: string;
  /** True when an active factor is being replaced (it stays active until confirm). */
  replacement: boolean;
  expiresAt: Date;
}

/** Fields of the requester's re-issued session after enable/disable. */
export interface MfaSessionUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  organizationId: string | null;
  tokenVersion: number;
}

export type EnableMfaResult =
  | { ok: true; user: MfaSessionUser; replaced: boolean }
  | { ok: false; reason: "no_pending" | "expired" | "stale" | "invalid_code" };

export type DisableMfaResult =
  | { ok: true; user: MfaSessionUser }
  | { ok: false; reason: "not_enabled" | "invalid_proof" };

/** A pending setup is confirmable for ten minutes. */
export const MFA_PENDING_TTL_MS = 10 * 60_000;

/** Clears a pending setup; also used by every password change/reset path. */
export const PENDING_MFA_CLEARED = {
  pendingTotpSecret: null,
  pendingTotpExpiresAt: null,
  pendingTotpTokenVersion: null,
} as const;

const ACCOUNT_INACTIVE = "Akun tidak aktif";
const WRONG_PASSWORD = "Password saat ini tidak sesuai";
/** One message for either wrong factor, so the endpoint is no password oracle. */
const WRONG_PROOF = "Password atau kode MFA tidak valid";
const CURRENT_CODE_REQUIRED =
  "Masukkan kode dari aplikasi authenticator yang aktif untuk mengganti perangkat MFA";

/** Wrong password or TOTP during setup (HTTP 400). Never carries a secret or code. */
export class MfaProofError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "MfaProofError";
  }
}

const SESSION_USER_SELECT = {
  id: true, email: true, name: true, role: true, organizationId: true, tokenVersion: true,
} as const;

/**
 * Single use (RFC 6238 §5.2): a code of the active factor is accepted only if
 * its time step is after `totpLastUsedStep`, the step of the last accepted
 * code (login, setup/disable proof, or the confirm code that made the factor
 * active). Every acceptance records its step in the same write.
 */
function isFreshStep(step: number | null, lastUsedStep: number | null): step is number {
  return step !== null && (lastUsedStep === null || step > lastUsedStep);
}

type ProofResult = { ok: false } | { ok: true; step: number | null };

/**
 * Password and (when MFA is on) an unused code of the active factor, checked
 * against the locked row. `step` is the code's time step to record, or null
 * when MFA is off and no code was checked.
 */
async function checkProof(
  user: { passwordHash: string | null; mfaEnabled: boolean; totpSecret: string | null; totpLastUsedStep: number | null },
  currentPassword: string,
  currentCode: string | undefined,
): Promise<ProofResult> {
  const passwordOk = Boolean(user.passwordHash) && (await verifyPassword(currentPassword, user.passwordHash!));
  if (!user.mfaEnabled) return passwordOk ? { ok: true, step: null } : { ok: false };
  const active = readTotpSecret(user.totpSecret);
  const step = active && currentCode ? findTotpStep(active, currentCode) : null;
  return passwordOk && isFreshStep(step, user.totpLastUsedStep) ? { ok: true, step } : { ok: false };
}

/**
 * Starts a first setup or a replacement. Under the User lock: the account must
 * be active, the password must match and, when MFA is on, so must a code of the
 * active factor. Only the pending fields are written (encrypted secret, 10
 * minutes, current tokenVersion); totpSecret and mfaEnabled never change here.
 * The existing secret is never returned. Throws HttpError 422 when an active
 * factor is replaced without a code (checked before the password, so a stolen
 * session cannot test passwords without the TOTP) and MfaProofError (400) on a
 * wrong password/code.
 */
export async function beginMfaSetup(
  userId: string,
  email: string,
  proof: MfaSetupProof,
): Promise<MfaSetupStarted> {
  const secret = generateTotpSecret();
  const sealed = encrypt(secret);

  const started = await runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        status: true, passwordHash: true, mfaEnabled: true, totpSecret: true, totpLastUsedStep: true, tokenVersion: true,
      },
    });
    if (user.status !== "ACTIVE") throw new HttpError(403, ACCOUNT_INACTIVE);
    if (user.mfaEnabled && !proof.currentCode) throw new HttpError(422, CURRENT_CODE_REQUIRED);
    const checked = await checkProof(user, proof.currentPassword, proof.currentCode);
    if (!checked.ok) throw new MfaProofError(user.mfaEnabled ? WRONG_PROOF : WRONG_PASSWORD);

    const expiresAt = new Date(Date.now() + MFA_PENDING_TTL_MS);
    await tx.user.update({
      where: { id: userId },
      data: {
        pendingTotpSecret: sealed, pendingTotpExpiresAt: expiresAt, pendingTotpTokenVersion: user.tokenVersion,
        // The proof code of the active factor is used up with this write.
        ...(checked.step !== null ? { totpLastUsedStep: checked.step } : {}),
      },
    });
    return { replacement: user.mfaEnabled, expiresAt };
  });

  return { secret, otpauthUrl: buildTotpAuthUrl({ secret, email }), ...started };
}

/**
 * Confirms the pending setup with a code of the pending secret. Under the User
 * lock it re-reads the pending fields: missing, expired or from an older
 * tokenVersion is refused (expired/stale ones are discarded); a wrong code
 * keeps the setup. On success the pending secret becomes the active factor in
 * one update that also clears the pending fields and increments tokenVersion,
 * which revokes every session. The caller issues the requester's new session
 * from `user` after commit.
 */
export async function enableMfa(userId: string, code: string): Promise<EnableMfaResult> {
  return runWalletTransaction(async (tx): Promise<EnableMfaResult> => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        status: true, mfaEnabled: true, tokenVersion: true,
        pendingTotpSecret: true, pendingTotpExpiresAt: true, pendingTotpTokenVersion: true,
      },
    });
    if (user.status !== "ACTIVE") throw new HttpError(403, ACCOUNT_INACTIVE);
    if (!user.pendingTotpSecret || !user.pendingTotpExpiresAt || user.pendingTotpTokenVersion === null) {
      return { ok: false, reason: "no_pending" };
    }
    const expired = user.pendingTotpExpiresAt.getTime() <= Date.now();
    const stale = user.pendingTotpTokenVersion !== user.tokenVersion;
    const pending = readTotpSecret(user.pendingTotpSecret);
    if (expired || stale || !pending) {
      await tx.user.update({ where: { id: userId }, data: PENDING_MFA_CLEARED });
      return { ok: false, reason: expired ? "expired" : stale ? "stale" : "no_pending" };
    }
    const confirmStep = findTotpStep(pending, code);
    if (confirmStep === null) return { ok: false, reason: "invalid_code" };

    // Proof and pending code verified in this transaction: promote atomically.
    // The confirm code is the new factor's first used code (single use).
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        totpSecret: user.pendingTotpSecret, mfaEnabled: true,
        pendingTotpSecret: null, pendingTotpExpiresAt: null,
        pendingTotpTokenVersion: null, tokenVersion: { increment: 1 },
        totpLastUsedStep: confirmStep,
      },
      select: SESSION_USER_SELECT,
    });
    return { ok: true, user: { ...updated, role: updated.role as AppRole }, replaced: user.mfaEnabled };
  });
}

/**
 * Turns MFA off with the password and a code of the active factor (checked
 * under the User lock). Clears the factor and any pending setup and increments
 * tokenVersion, which revokes every session; the caller re-issues the
 * requester's session from `user` after commit.
 */
export async function disableMfa(
  userId: string,
  proof: { currentPassword: string; code: string },
): Promise<DisableMfaResult> {
  return runWalletTransaction(async (tx): Promise<DisableMfaResult> => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, passwordHash: true, mfaEnabled: true, totpSecret: true, totpLastUsedStep: true },
    });
    if (user.status !== "ACTIVE") throw new HttpError(403, ACCOUNT_INACTIVE);
    if (!user.mfaEnabled) return { ok: false, reason: "not_enabled" };
    if (!(await checkProof(user, proof.currentPassword, proof.code)).ok) return { ok: false, reason: "invalid_proof" };

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false, totpSecret: null, totpLastUsedStep: null, ...PENDING_MFA_CLEARED,
        tokenVersion: { increment: 1 },
      },
      select: SESSION_USER_SELECT,
    });
    return { ok: true, user: { ...updated, role: updated.role as AppRole } };
  });
}

/**
 * Discards a pending setup (the "Batal" button). The active factor, if any,
 * and tokenVersion are untouched. Returns whether a setup was pending.
 */
export async function cancelMfaSetup(userId: string): Promise<boolean> {
  return runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { pendingTotpSecret: true } });
    if (user.pendingTotpSecret === null) return false;
    await tx.user.update({ where: { id: userId }, data: PENDING_MFA_CLEARED });
    return true;
  });
}

/**
 * Login second factor. The code must match the active factor at a time step
 * after `totpLastUsedStep` (RFC 6238 §5.2: no second use of an OTP). The step
 * is claimed by a conditional update on the same factor, so of two concurrent
 * logins with one code exactly one succeeds; a lost claim counts as invalid.
 */
export async function verifyMfaLoginCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, mfaEnabled: true, status: true, totpLastUsedStep: true },
  });
  if (!user?.mfaEnabled || user.status !== "ACTIVE" || !user.totpSecret) return false;

  const secret = readTotpSecret(user.totpSecret);
  if (!secret) return false;
  const step = findTotpStep(secret, code);
  if (!isFreshStep(step, user.totpLastUsedStep)) return false;

  const claimed = await prisma.user.updateMany({
    where: {
      id: userId, mfaEnabled: true, status: "ACTIVE", totpSecret: user.totpSecret,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
    },
    data: { totpLastUsedStep: step },
  });
  return claimed.count === 1;
}

export async function signMfaChallenge(userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ purpose: "mfa", sub: userId, tokenVersion })
    .setIssuer("reloop")
    .setAudience("reloop-mfa")
    .setJti(randomUUID())
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(MFA_CHALLENGE_TTL)
    .sign(getJwtSecret());
}

const challengeClaims = tokenClaims.extend({
  purpose: z.literal("mfa"),
  jti: z.string().uuid(),
  exp: z.number().int().safe(),
});

export async function verifyMfaChallenge(token: string): Promise<{
  userId: string; tokenVersion: number; challengeId: string; expiresAt: number;
} | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"], issuer: "reloop", audience: "reloop-mfa",
    });
    const parsed = challengeClaims.safeParse(payload);
    if (!parsed.success) return null;
    return { userId: parsed.data.sub, tokenVersion: parsed.data.tokenVersion,
      challengeId: parsed.data.jti, expiresAt: parsed.data.exp };
  } catch {
    return null;
  }
}

export async function getMfaStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, mfaEnabled: true },
  });
  if (!user) return null;

  return {
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    requiredForRole: isPrivilegedRole(user.role as AppRole),
  };
}
