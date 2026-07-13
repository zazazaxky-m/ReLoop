import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppRole } from "./roles";

export const SESSION_COOKIE = "reloop_session";
const USER_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const PRIVILEGED_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours for ADMIN/SUPERADMIN

/** Session lifetime in seconds based on role. */
export function sessionMaxAgeSeconds(role: AppRole): number {
  return role === "ADMIN" || role === "SUPERADMIN"
    ? PRIVILEGED_MAX_AGE_SECONDS
    : USER_MAX_AGE_SECONDS;
}

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

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AppRole;
  organizationId: string | null;
  tokenVersion: number;
}

export function buildSessionPayload(user: {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  organizationId: string | null;
  tokenVersion: number;
}): SessionPayload {
  return {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    tokenVersion: user.tokenVersion,
  };
}

/** bcrypt cost 12 — slow enough for passwords; verify still accepts older cost-10 hashes. */
export const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const maxAge = sessionMaxAgeSeconds(payload.role);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as AppRole,
      organizationId: (payload.organizationId as string | null) ?? null,
      tokenVersion: Number(payload.tokenVersion ?? 0),
    };
  } catch {
    return null;
  }
}

/** Writes the session cookie. Only valid in Route Handlers / Server Actions. */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const maxAge = sessionMaxAgeSeconds(payload.role);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
