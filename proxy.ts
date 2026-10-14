import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth-tokens";
import { buildSecurityHeaders, NONCE_HEADER } from "@/lib/security-headers";
import { publicOrigin } from "@/lib/site";

const SESSION_COOKIE = "reloop_session";

const PUBLIC_API_EXACT = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/mfa/verify",
  // Public account-deletion form and its emailed confirmation (owner verified by token).
  "/api/account-deletion-requests",
  "/api/account-deletion-requests/confirm",
  "/api/data-deletion-requests",
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

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isPublicApiPath(pathname: string): boolean {
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Origins whose browser requests may change state (P01). Only the configured
 * public origin (NEXT_PUBLIC_BASE_URL) is trusted, never request.nextUrl or the
 * Host / X-Forwarded-Host headers: Next builds nextUrl from the server's bind
 * address (http://0.0.0.0:3000 in the Docker image behind nginx), and the
 * headers are client-controlled. In production an unset or invalid base URL
 * leaves nothing trusted, so every state-changing request that carries an
 * Origin is refused. Outside production the dev server's own loopback origins
 * on its port are trusted too.
 */
function trustedOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>();
  const configured = publicOrigin();
  if (configured) origins.add(configured);
  if (process.env.NODE_ENV !== "production") {
    const { protocol, port } = req.nextUrl;
    for (const host of LOOPBACK_HOSTS) origins.add(`${protocol}//${host}${port ? `:${port}` : ""}`);
  }
  return origins;
}

function isSameOriginUnsafeRequest(req: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.get("origin");
  if (origin) {
    const trusted = trustedOrigins(req);
    if (trusted.size === 0) {
      console.error("[proxy] NEXT_PUBLIC_BASE_URL is not configured or invalid; refusing a state-changing request that carries an Origin header");
    }
    if (!trusted.has(origin)) return false;
  }
  const site = req.headers.get("sec-fetch-site");
  return site !== "cross-site";
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? (await verifySessionToken(token)) !== null : false;
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

/**
 * Pages that read a single-use emailed token (A03). The token travels in the
 * URL fragment and the page removes it before anything else loads; these
 * headers also keep the page out of indexes, caches and Referer headers.
 */
const TOKEN_PAGES = new Set(["/accept-invitation", "/verify-email"]);

function withTokenPageHeaders(response: NextResponse) {
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
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
    } else if (!isSameOriginUnsafeRequest(req)) {
      response = NextResponse.json(
        { error: "Permintaan tidak valid" },
        { status: 403 },
      );
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

  withSecurityHeaders(response, nonce);
  return TOKEN_PAGES.has(pathname) ? withTokenPageHeaders(response) : response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
