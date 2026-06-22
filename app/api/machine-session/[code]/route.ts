import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";

const ACTIVE_SESSION_STATUSES = [
  "RESERVED",
  "ACTIVE",
  "PROCESSING_ITEM",
  "REVIEW",
] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const machine = await prisma.machine.findUnique({
    where: { machineCode: code },
    select: {
      id: true,
      ingestSecret: true,
      sessionIdleTimeoutMinutes: true,
    },
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

  let session = await prisma.depositSession.findFirst({
    where: {
      machineId: machine.id,
      status: { in: [...ACTIVE_SESSION_STATUSES] },
    },
    orderBy: { startedAt: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      items: {
        include: { wasteType: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (session?.timeoutAt && session.timeoutAt.getTime() <= Date.now()) {
    await prisma.depositSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED", completedAt: new Date() },
    });
    session = null;
  }

  if (!session) {
    return jsonOk({
      lease: null,
      session: null,
      idleTimeoutMinutes: machine.sessionIdleTimeoutMinutes,
    });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const serverExpiry = session.timeoutAt
    ? Math.floor(session.timeoutAt.getTime() / 1000)
    : issuedAt + machine.sessionIdleTimeoutMinutes * 60;
  const expiresAt = Math.min(serverExpiry, issuedAt + 300);
  const id = `lease-${session.id}`;
  const canonical = [id, session.id, issuedAt, expiresAt].join(".");
  const signature = createHmac("sha256", machine.ingestSecret)
    .update(canonical)
    .digest("hex");

  const totalQuantity = session.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const totalReward = session.items.reduce(
    (sum, item) => sum + item.rewardAmount,
    0,
  );

  return jsonOk({
    lease: {
      id,
      sessionId: session.id,
      userRef: session.user.id,
      issuedAt,
      expiresAt,
      signature,
    },
    session: {
      id: session.id,
      status: session.status,
      userName: session.user.name,
      startedAt: session.startedAt,
      timeoutAt: session.timeoutAt,
      totalQuantity,
      totalReward,
      items: session.items.map((item) => ({
        id: item.id,
        wasteTypeId: item.wasteType.id,
        wasteTypeName: item.wasteType.name,
        quantity: item.quantity,
        rewardAmount: item.rewardAmount,
        status: item.status,
      })),
    },
    idleTimeoutMinutes: machine.sessionIdleTimeoutMinutes,
  });
}
