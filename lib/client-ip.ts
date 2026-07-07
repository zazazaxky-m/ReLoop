/**
 * Client IP for rate limiting and audit metadata.
 *
 * When TRUST_PROXY=true or NODE_ENV=production, prefer X-Real-IP set by nginx
 * (not client-spoofable). Falls back to the leftmost X-Forwarded-For hop.
 */
export function getClientIp(req: Request): string {
  const trustProxy =
    process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production";

  const realIp = req.headers.get("x-real-ip")?.trim();
  const forwarded = req.headers.get("x-forwarded-for");

  if (trustProxy) {
    if (realIp) return realIp;
    const first = forwarded?.split(",")[0]?.trim();
    return first || "unknown";
  }

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  if (realIp) return realIp;
  return "unknown";
}
