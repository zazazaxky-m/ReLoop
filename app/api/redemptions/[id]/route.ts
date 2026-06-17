import { z } from "zod";
import type { RedemptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { settleRedeemLedger } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  action: z.enum(["approve", "process", "success", "fail", "cancel"]),
  note: z.string().max(500).optional(),
  providerReference: z.string().max(120).optional(),
});

const FROM: Record<string, RedemptionStatus[]> = {
  approve: ["REQUESTED"],
  process: ["APPROVED"],
  success: ["REQUESTED", "APPROVED", "PROCESSING"],
  fail: ["REQUESTED", "APPROVED", "PROCESSING"],
  cancel: ["REQUESTED"],
};

const TO: Record<string, RedemptionStatus> = {
  approve: "APPROVED",
  process: "PROCESSING",
  success: "SUCCESS",
  fail: "FAILED",
  cancel: "REVERSED",
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER", "SUPERADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const redemption = await prisma.redemption.findUnique({ where: { id } });
    if (!redemption) throw new HttpError(404, "Redemption tidak ditemukan");

    // User may only cancel their own still-pending request.
    if (user.role === "USER") {
      if (redemption.userId !== user.id) throw new HttpError(403, "Bukan redemption Anda");
      if (body.action !== "cancel") throw new HttpError(403, "Aksi tidak diizinkan");
    }

    const target = TO[body.action];

    // Idempotency: re-issuing the same terminal outcome is a no-op.
    if (redemption.status === target) {
      return jsonOk({ redemption, idempotent: true });
    }
    if (!FROM[body.action].includes(redemption.status)) {
      throw new HttpError(409, `Tidak bisa ${body.action} dari status ${redemption.status}`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.redemption.update({
        where: { id },
        data: {
          status: target,
          note: body.note ?? undefined,
          providerReference: body.providerReference ?? undefined,
          processedBySuperadminId: user.role === "SUPERADMIN" ? user.id : undefined,
        },
      });
      if (body.action === "success") {
        await settleRedeemLedger(id, "success", tx);
      } else if (body.action === "fail" || body.action === "cancel") {
        await settleRedeemLedger(id, "failed", tx);
      }
      return row;
    });

    await logAudit({
      actorId: user.id,
      action: `REDEMPTION_${body.action.toUpperCase()}`,
      entityType: "Redemption",
      entityId: id,
      metadata: { from: redemption.status, to: target, note: body.note },
    });

    return jsonOk({ redemption: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
