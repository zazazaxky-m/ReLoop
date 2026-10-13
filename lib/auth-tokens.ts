import { jwtVerify } from "jose";
import { z } from "zod";

/** Shared by server guards and the request proxy; never imports DB or cookies. */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret === "dev-insecure-secret-change-me") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

export const tokenClaims = z.object({
  sub: z.string().min(1),
  tokenVersion: z.number().int().nonnegative().safe(),
  iat: z.number().finite(),
  exp: z.number().finite(),
});
const sessionClaims = tokenClaims.extend({
  purpose: z.literal("session"),
  email: z.string(),
  name: z.string(),
  role: z.enum(["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"]),
  organizationId: z.string().nullable(),
});

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"], issuer: "reloop", audience: "reloop-session",
    });
    if (payload.purpose !== "session") return null;
    const parsed = sessionClaims.safeParse(payload);
    if (!parsed.success) return null;
    const { sub, email, name, role, organizationId, tokenVersion } = parsed.data;
    return { sub, email, name, role, organizationId, tokenVersion };
  } catch {
    return null;
  }
}
