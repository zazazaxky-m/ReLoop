import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { decrypt, encrypt, isEncrypted } from "./encryption";
import {
  buildTotpAuthUrl,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp";
import type { AppRole } from "./roles";

const MFA_CHALLENGE_TTL = "5m";
const PRIVILEGED_ROLES = new Set<AppRole>(["ADMIN", "SUPERADMIN"]);

function getJwtSecret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s === "dev-insecure-secret-change-me") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-insecure-secret-change-me");
  }
  return new TextEncoder().encode(s);
}

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

export async function beginMfaSetup(userId: string, email: string) {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: encrypt(secret),
      mfaEnabled: false,
    },
  });

  return {
    secret,
    otpauthUrl: buildTotpAuthUrl({ secret, email }),
  };
}

export async function enableMfa(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true },
  });
  const secret = readTotpSecret(user?.totpSecret);
  if (!secret || !verifyTotpCode(secret, code)) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: true },
  });
  return true;
}

export async function disableMfa(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, mfaEnabled: true },
  });
  if (!user?.mfaEnabled) return true;

  const secret = readTotpSecret(user.totpSecret);
  if (!secret || !verifyTotpCode(secret, code)) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, totpSecret: null },
  });
  return true;
}

export async function verifyMfaLoginCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, mfaEnabled: true, status: true },
  });
  if (!user?.mfaEnabled || user.status !== "ACTIVE") return false;

  const secret = readTotpSecret(user.totpSecret);
  if (!secret) return false;
  return verifyTotpCode(secret, code);
}

export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({ purpose: "mfa", sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(MFA_CHALLENGE_TTL)
    .sign(getJwtSecret());
}

export async function verifyMfaChallenge(
  token: string,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.purpose !== "mfa" || !payload.sub) return null;
    return { userId: String(payload.sub) };
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
