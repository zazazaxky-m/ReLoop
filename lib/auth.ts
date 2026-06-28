import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { AppRole } from "./roles";

export const SESSION_COOKIE = "reloop_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const secret = new TextEncoder().encode(
  (() => {
    const s = process.env.AUTH_JWT_SECRET;
    if (!s || s === "dev-insecure-secret-change-me") {
      if (process.env.NODE_ENV === "production") {
        throw new Error("AUTH_JWT_SECRET must be set in production");
      }
      return "dev-insecure-secret-change-me";
    }
    return s;
  })(),
);

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AppRole;
  organizationId: string | null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as AppRole,
      organizationId: (payload.organizationId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Writes the session cookie. Only valid in Route Handlers / Server Actions. */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
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
