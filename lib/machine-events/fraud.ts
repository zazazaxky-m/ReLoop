import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { sendPushToUsersBestEffort } from "../notifications";

export async function flagAnomaly(
  tx: Prisma.TransactionClient,
  sessionId: string,
  depositItemId: string | null | undefined,
  reason: string,
) {
  if (depositItemId) {
    await tx.depositItem.update({
      where: { id: depositItemId },
      data: { status: "REVIEW", validationReasonCode: reason },
    });
  }
  const session = await tx.depositSession.findUnique({
    where: { id: sessionId },
  });
  if (session && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(session.status)) {
    await tx.depositSession.update({
      where: { id: sessionId },
      data: {
        status: ["ACTIVE", "PROCESSING_ITEM"].includes(session.status)
          ? "REVIEW"
          : session.status,
        anomalyCount: { increment: 1 },
      },
    });
  }
}

/** Best-effort fan-out to every ACTIVE admin of an organization. Used for
 * machine FULL/fraud alerts, which are operational signals the org's own
 * admins need to act on (superadmins already have the global security
 * dashboard). */
export async function notifyOrgAdmins(
  organizationId: string,
  params: { type: "MACHINE_FULL" | "MACHINE_FRAUD"; title: string; body: string; data?: Record<string, unknown> },
) {
  try {
    const admins = await prisma.user.findMany({
      where: { organizationId, role: "ADMIN", status: "ACTIVE" },
      select: { id: true },
    });
    if (admins.length === 0) return;

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: params.type,
        title: params.title,
        body: params.body,
        dataJson: (params.data ?? undefined) as object | undefined,
      })),
    });

    void sendPushToUsersBestEffort(
      admins.map((admin) => admin.id),
      params.title,
      params.body,
      params.data,
    );
  } catch (err) {
    console.error("[machine-events] notifyOrgAdmins failed:", err);
  }
}
