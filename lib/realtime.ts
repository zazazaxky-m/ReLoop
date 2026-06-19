type RealtimeMessage = {
  topic: "machine-event" | "security-alert" | "machine-state";
  machineCode: string;
  eventType: string;
  eventId?: string;
  occurredAt?: string;
};

export async function publishRealtime(message: RealtimeMessage) {
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
