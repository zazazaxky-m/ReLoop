import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";

/**
 * Outbound-friendly session bridge for edge RVMs.
 * The machine polls only while IDLE; no inbound route/NAT setup is required.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const machine = await prisma.machine.findUnique({
    where: { machineCode: code },
    select: { id: true, ingestSecret: true, chamberTimeoutSeconds: true },
  });
  if (!machine) return jsonError(404, "Mesin tidak ditemukan");
  if (!machine.ingestSecret) return jsonError(401, "Secret mesin belum tersedia");

  const verdict = verifyMachineSignature({
    secret: machine.ingestSecret,
    timestamp: req.headers.get("x-reloop-timestamp"),
    nonce: req.headers.get("x-reloop-nonce"),
    signature: req.headers.get("x-reloop-signature"),
    rawBody: "",
  });
  if (!verdict.ok) {
    return jsonError(401, `Tanda tangan tidak valid (${verdict.reason})`);
  }

  const session = await prisma.depositSession.findFirst({
    where: {
      machineId: machine.id,
      status: { in: ["RESERVED", "ACTIVE", "PROCESSING_ITEM"] },
    },
    orderBy: { startedAt: "desc" },
    include: { user: { select: { id: true } } },
  });
  if (!session) return jsonOk({ lease: null });

  const issuedAt = Math.floor(Date.now() / 1000);
  const serverExpiry = session.timeoutAt?.getTime()
    ? Math.floor(session.timeoutAt.getTime() / 1000)
    : issuedAt + machine.chamberTimeoutSeconds * 60;
  const expiresAt = Math.min(serverExpiry, issuedAt + 300);
  const id = `lease-${session.id}`;
  const canonical = [id, session.id, issuedAt, expiresAt].join(".");
  const signature = createHmac("sha256", machine.ingestSecret)
    .update(canonical)
    .digest("hex");

  return jsonOk({
    lease: {
      id,
      sessionId: session.id,
      userRef: session.user.id,
      issuedAt,
      expiresAt,
      signature,
    },
  });
}
