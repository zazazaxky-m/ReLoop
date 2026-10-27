import type { RewardReconciliationCase } from "@prisma/client";
import { z } from "zod";
import { typeErrors } from "./zod-errors";
import { logAudit } from "./audit";
import { lockUser } from "./db-locks";
import { HttpError, type CurrentUser } from "./rbac";
import { afterCommitSafely, runWalletTransaction } from "./wallet-service";

/**
 * Operator resolution of a reward reconciliation case (lib/reward-credit.ts).
 * A SUPERADMIN closes an OPEN case once the money question is settled outside
 * the ledger (refunded, written off, credited by hand): the ledger is never
 * touched, and an ANOMALY_ALREADY_PAID_OUT case stops holding the user's
 * withdrawals (`heldByOpenDebitCases`). The written outcome stays on the case;
 * the immutable audit chain only records that one exists.
 */

const REWARD_CASE_NOT_FOUND = "Kasus rekonsiliasi tidak ditemukan";
const REWARD_CASE_CHANGED = "Kasus rekonsiliasi sudah berubah. Muat ulang halaman.";

export const rewardCaseResolveSchema = z.object({
  note: z
    .string({ error: typeErrors({ required: "Catatan penyelesaian wajib diisi" }) })
    .trim()
    .min(10, "Catatan penyelesaian minimal 10 karakter")
    .max(500, "Catatan penyelesaian maksimal 500 karakter"),
});

export async function resolveRewardCase(
  actor: CurrentUser,
  caseId: string,
  input: z.infer<typeof rewardCaseResolveSchema>,
): Promise<{ rewardCase: RewardReconciliationCase; idempotent: boolean }> {
  if (actor.role !== "SUPERADMIN") throw new HttpError(403, "Akses ditolak untuk peran ini");
  const outcome = await runWalletTransaction(async (tx) => {
    // The owner never changes: read it to know which User row to lock, then
    // decide on the row re-read under that lock.
    const owner = await tx.rewardReconciliationCase.findUnique({ where: { id: caseId }, select: { userId: true } });
    if (!owner) throw new HttpError(404, REWARD_CASE_NOT_FOUND);
    await lockUser(tx, owner.userId);
    const current = await tx.rewardReconciliationCase.findUniqueOrThrow({ where: { id: caseId } });
    if (current.status === "RESOLVED") return { rewardCase: current, idempotent: true };
    const changed = await tx.rewardReconciliationCase.updateMany({
      where: { id: caseId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actor.id, note: input.note },
    });
    if (changed.count !== 1) throw new HttpError(409, REWARD_CASE_CHANGED);
    return { rewardCase: await tx.rewardReconciliationCase.findUniqueOrThrow({ where: { id: caseId } }), idempotent: false };
  });
  if (!outcome.idempotent) {
    const { rewardCase } = outcome;
    await afterCommitSafely("audit REWARD_CASE_RESOLVED", () =>
      logAudit({
        actorId: actor.id,
        action: "REWARD_CASE_RESOLVED",
        entityType: "RewardReconciliationCase",
        entityId: rewardCase.id,
        metadata: { reasonCode: rewardCase.reasonCode, amount: rewardCase.amount, hasNote: true },
      }),
    );
  }
  return outcome;
}
