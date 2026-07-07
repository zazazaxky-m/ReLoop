import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { buildSecurityHeaders, NONCE_HEADER } from "@/lib/security-headers";

const SESSION_COOKIE = "reloop_session";

const PUBLIC_API_EXACT = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/mfa/verify",
  "/api/internal/ws-session",
  "/api/public/hero-slides",
  "/api/public/hero-image",
  "/api/public/campaigns",
  "/api/machine-events",
  "/api/machine-captures",
]);

const PUBLIC_API_PREFIXES = [
  "/api/display/",
  "/api/machine-session/",
  "/api/machine-commands/",
  "/api/machine-media/manifest/",
  "/api/machine-media/download/",
];

function isPublicApiPath(pathname: string): boolean {
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret === "dev-insecure-secret-change-me") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET must be set in production");
    }
    return new TextEncoder().encode("dev-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getJwtSecret());
    return true;
  } catch {
    return false;
  }
}

function withSecurityHeaders(response: NextResponse, nonce: string) {
  for (const header of buildSecurityHeaders({
    nonce,
    hsts: process.env.NODE_ENV === "production",
    allowUnsafeEval: process.env.NODE_ENV !== "production",
    allowUnsafeInlineStyles: process.env.NODE_ENV !== "production",
  })) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

export async function proxy(req: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);

  const { pathname } = req.nextUrl;
  let response: NextResponse;

  if (pathname.startsWith("/api/")) {
    if (isPublicApiPath(pathname)) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    } else if (await hasValidSession(req)) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    } else {
      response = NextResponse.json(
        { error: "Tidak terautentikasi" },
        { status: 401 },
      );
    }
  } else if (pathname.startsWith("/dashboard/")) {
    if (await hasValidSession(req)) {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    } else {
      response = NextResponse.redirect(new URL("/login", req.url));
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  return withSecurityHeaders(response, nonce);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
