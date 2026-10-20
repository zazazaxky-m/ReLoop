import { appendFileSync, existsSync, readFileSync } from "node:fs";

/**
 * Test-only capture sink for outgoing mail/push. It is selected solely by the
 * audit test runner (AUDIT_TEST_RUN=1 + AUDIT_TRANSPORT_SINK, a file in the
 * run's temp dir) so a real Next.js child can be exercised without sending
 * anything. There is no HTTP surface, and production ignores it entirely.
 */
export type CapturedTransport =
  | { kind: "mail"; to: string; subject: string; text: string; html: string }
  | { kind: "push"; tokens: string[]; title: string; body: string; data?: Record<string, string> };

export function auditTransportSink(): string | null {
  if (process.env.AUDIT_TEST_RUN !== "1") return null;
  if (process.env.NODE_ENV === "production") return null;
  const sink = process.env.AUDIT_TRANSPORT_SINK?.trim();
  if (!sink) {
    // Never fall through to a real provider during an audit run.
    throw new Error("AUDIT_TEST_RUN=1 requires AUDIT_TRANSPORT_SINK; refusing to use a real mail/push provider");
  }
  return sink;
}

export function captureTransport(sink: string, message: CapturedTransport): void {
  appendFileSync(sink, `${JSON.stringify(message)}\n`, { mode: 0o600 });
}

export function readCapturedTransport(sink: string): CapturedTransport[] {
  if (!existsSync(sink)) return [];
  return readFileSync(sink, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CapturedTransport);
}
