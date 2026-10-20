/**
 * Public topics reach every socket, including the anonymous kiosk display;
 * the gateway forwards only `topic`, `machineCode`, `eventType` and
 * `occurredAt` (non-private machine state).
 */
type PublicRealtimeMessage = {
  topic: "machine-event" | "machine-state";
  machineCode: string;
  eventType: string;
  eventId?: string;
  occurredAt?: string;
  /** Owner organization read from the database; never forwarded on public topics. */
  organizationId?: string;
};

/**
 * Restricted topics reach only verified ADMIN sockets of `organizationId`
 * and SUPERADMIN sockets. The organization must come from trusted database
 * data (e.g. the machine row), never from a client or machine payload.
 */
type RestrictedRealtimeMessage = {
  topic: "security-alert";
  organizationId: string;
  machineCode: string;
  eventType: string;
  eventId?: string;
  occurredAt?: string;
};

export type RealtimeMessage = PublicRealtimeMessage | RestrictedRealtimeMessage;

export async function publishRealtime(message: RealtimeMessage) {
  if (
    message.topic === "security-alert" &&
    !(typeof message.organizationId === "string" && message.organizationId)
  ) {
    // An unscoped alert is never sent (the gateway would reject it too).
    console.warn("[realtime] security-alert without organizationId not published");
    return;
  }
  const url =
    process.env.REALTIME_PUBLISH_URL ?? "http://127.0.0.1:3001/publish";
  const secret =
    process.env.REALTIME_INTERNAL_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "reloop-dev-realtime-secret");
  if (!secret) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    });
  } catch {
    // Realtime is an optional acceleration layer; persisted DB data remains canonical.
  }
}
