export const SITE_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "ReLoop";

export const SITE_DESCRIPTION =
  "ReLoop adalah platform bank sampah digital: setor sampah daur ulang di mesin ReLoop, kumpulkan reward transparan, dan pantau dampak lingkunganmu.";

// Read at request time so the deployed NEXT_PUBLIC_BASE_URL is used for
// canonical, Open Graph, robots, and sitemap URLs instead of a build-time value.
export function siteUrl(): URL {
  return new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000");
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, siteUrl()).toString();
}

/** Answer when links cannot be built safely (no configured base URL in production). */
export const LINK_BASE_UNAVAILABLE = "Layanan sedang tidak tersedia. Coba lagi nanti.";

/**
 * Origin for links sent by email (password reset, account-deletion
 * confirmation). Only the configured NEXT_PUBLIC_BASE_URL is trusted, never the
 * request Host header, which the client controls: a forged Host would put a
 * live token on the attacker's domain. Outside production an unset value falls
 * back to the local default; in production (or with an unparsable value) this
 * returns null and the caller must fail closed without sending anything.
 */
export function emailLinkBase(): string | null {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (!configured) return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
