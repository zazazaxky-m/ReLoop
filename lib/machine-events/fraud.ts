import type { Prisma } from "@prisma/client";
import { lockDepositItem, lockDepositSession, lockUser } from "../db-locks";
import { getWalletBalance } from "../ledger";
import { prisma } from "../prisma";
import { sendPushToUsersBestEffort } from "../notifications";
import { CASE_ALREADY_PAID_OUT, openRewardReconciliationCase } from "../reward-credit";
import { isReviewDecision } from "./shared";

/**
 * Marks the session (then the item: DepositSession before DepositItem, the
 * global lock order) as under review after an anomaly.
 */
export async function flagAnomaly(
  tx: Prisma.TransactionClient,
  sessionId: string,
  depositItemId: string | null | undefined,
  reason: string,
) {
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
  if (depositItemId) {
    await tx.depositItem.update({
      where: { id: depositItemId },
      data: { status: "REVIEW", validationReasonCode: reason },
    });
  }
}

/** Business key of the case a fraud hold opens when the earning was already paid out or reserved. */
export function fraudHoldKey(depositItemId: string): string {
  return `fraud:${depositItemId}:hold:v1`;
}

export interface FraudHoldResult {
  sessionId: string;
  /** The item carries a reviewer's final decision, which a later machine signal never reopens. */
  reviewFinal: boolean;
  /** Rupiah moved from AVAILABLE to PENDING by this hold. */
  heldAmount: number;
  /** Case opened instead of a hold that would have made the balance negative. */
  reconciliationCaseId: string | null;
}

/**
 * FRAUD_DETECTED / VANDALISM_DETECTED for one item (task M04).
 *
 * Locks the reward recipient User -> DepositSession -> DepositItem (learned
 * from the immutable relations), then puts the item back in review and moves
 * its AVAILABLE earning to PENDING, but only while the recipient's available
 * balance (read under the User lock, reserves included) still covers it. An
 * earning that was already paid out or reserved stays AVAILABLE and an OPEN
 * reconciliation case `fraud:<itemId>:hold:v1` records it: the balance is
 * never pushed below zero. A reviewer's final decision is kept; the item only
 * gets the fraud flag.
 */
export async function holdItemForFraud(
  tx: Prisma.TransactionClient,
  depositItemId: string,
  reason: string,
): Promise<FraudHoldResult | null> {
  const ref = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    select: { sessionId: true, session: { select: { userId: true } } },
  });
  if (!ref) return null;
  const userId = ref.session.userId;
  await lockUser(tx, userId);
  await lockDepositSession(tx, ref.sessionId);
  await lockDepositItem(tx, depositItemId);

  const item = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    select: { validationReasonCode: true },
  });
  if (!item) return null;
  if (isReviewDecision(item.validationReasonCode)) {
    await tx.depositItem.update({ where: { id: depositItemId }, data: { externalFraudFlag: true } });
    return { sessionId: ref.sessionId, reviewFinal: true, heldAmount: 0, reconciliationCaseId: null };
  }

  await tx.depositItem.update({
    where: { id: depositItemId },
    data: { status: "REVIEW", externalFraudFlag: true, validationReasonCode: reason },
  });

  let heldAmount = 0;
  let reconciliationCaseId: string | null = null;
  const earnings = await tx.rewardLedger.findMany({
    where: { depositItemId, userId, entryType: "EARN", status: "AVAILABLE" },
    orderBy: { id: "asc" },
  });
  for (const earn of earnings) {
    const { available } = await getWalletBalance(userId, tx);
    if (available >= earn.amount) {
      // Only `status` changes: the ledger stays append-only.
      const { count } = await tx.rewardLedger.updateMany({
        where: { id: earn.id, status: "AVAILABLE" },
        data: { status: "PENDING" },
      });
      if (count !== 1) throw new Error("REWARD_LEDGER_CHANGED");
      heldAmount += earn.amount;
    } else {
      const opened = await openRewardReconciliationCase(tx, {
        businessKey: fraudHoldKey(depositItemId),
        userId,
        amount: earn.amount,
        entryType: "EARN",
        reasonCode: CASE_ALREADY_PAID_OUT,
        depositItemId,
        referenceType: "DepositItem",
        referenceId: depositItemId,
      });
      reconciliationCaseId = opened.id;
    }
  }
  return { sessionId: ref.sessionId, reviewFinal: false, heldAmount, reconciliationCaseId };
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
