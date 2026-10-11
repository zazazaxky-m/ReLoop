/**
 * WebSocket URL for the realtime gateway.
 *
 * NEXT_PUBLIC_* values are inlined at build time, and the Docker build doesn't
 * receive NEXT_PUBLIC_REALTIME_WS_URL, so production must not fall back to
 * localhost. nginx proxies /ws on the app's own origin, which connect-src
 * 'self' already allows.
 */
export function realtimeWsUrl(
  location: Pick<Location, "protocol" | "host"> = window.location,
): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_WS_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "ws://localhost:3001/ws";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}
