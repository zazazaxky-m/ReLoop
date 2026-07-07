import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { createEarnEntry } from "@/lib/ledger";
import {
  resolveRewardRate,
  computeRewardAmount,
  computeWeightBasedRewardAmount,
} from "@/lib/reward";
import { UNKNOWN_WASTE_TYPE_REASON } from "@/lib/machine-events";

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  // Reclassification target when the item was created via the unknown
  // waste-type fallback (or the reviewer determines the original guess was
  // wrong). Required for "approve" when the item has no resolvable type.
  wasteTypeId: z.string().optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Resolves deposit items stuck in REVIEW: sensor/fraud anomalies (created
 * with a 50% reward already reserved as EARN/PENDING) and the
 * unknown-waste-type fallback (created with a 0 reward and no ledger entry).
 * `approve` recomputes the full reward and releases/creates the ledger entry
 * accordingly; `reject` finalizes the item at zero reward. The ledger stays
 * append-only: existing rows only have their `status` changed, corrections
 * always land in a new ADJUST/REVERSE row.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const item = await prisma.depositItem.findUnique({
      where: { id },
      include: {
        wasteType: true,
        ledgerEntries: { where: { entryType: "EARN" } },
        session: {
          include: {
            campaign: true,
            machine: { select: { organizationId: true } },
            user: { select: { id: true } },
          },
        },
      },
    });
    if (!item) throw new HttpError(404, "Item setoran tidak ditemukan");
    if (item.status !== "REVIEW") {
      throw new HttpError(
        409,
        `Item sudah berstatus ${item.status}, tidak lagi menunggu peninjauan`,
      );
    }

    assertOrgScope(user, item.session.machine.organizationId);
    const earnEntry = item.ledgerEntries[0] ?? null;

    if (body.action === "reject") {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.depositItem.update({
          where: { id },
          data: {
            status: "REJECTED",
            rewardAmount: 0,
            validationReasonCode: "REVIEW_REJECTED",
          },
        });
        if (earnEntry?.status === "PENDING") {
          await tx.rewardLedger.update({
            where: { id: earnEntry.id },
            data: { status: "REJECTED" },
          });
        } else if (earnEntry?.status === "AVAILABLE") {
          // Defensive: should not normally happen for a REVIEW item, but
          // never leave an already-spendable EARN row unreversed.
          await tx.rewardLedger.create({
            data: {
              userId: item.session.user.id,
              organizationId: item.session.machine.organizationId,
              sessionId: item.sessionId,
              depositItemId: item.id,
              entryType: "REVERSE",
              amount: -earnEntry.amount,
              status: "AVAILABLE",
              reasonCode: "REVIEW_REJECTED",
              referenceType: "DepositItem",
              referenceId: item.id,
              actorId: user.id,
            },
          });
        }
        return row;
      });

      await logAudit({
        actorId: user.id,
        action: "DEPOSIT_REVIEW_REJECTED",
        entityType: "DepositItem",
        entityId: id,
        metadata: { note: body.note, previousReasonCode: item.validationReasonCode },
      });

      return jsonOk({ item: updated });
    }

    // action === "approve"
    const wasUnknown = item.validationReasonCode === UNKNOWN_WASTE_TYPE_REASON;
    if (wasUnknown && !body.wasteTypeId) {
      throw new HttpError(422, "wasteTypeId wajib diisi untuk item tanpa jenis sampah");
    }

    let wasteType = item.wasteType;
    if (body.wasteTypeId && body.wasteTypeId !== item.wasteTypeId) {
      const found = await prisma.wasteType.findUnique({ where: { id: body.wasteTypeId } });
      if (!found) throw new HttpError(422, "Jenis sampah pengganti tidak ditemukan");
      wasteType = found;
    }
    const effectiveWasteTypeId = wasteType.id;

    const quantity = body.quantity ?? item.quantity;
    const rate = await resolveRewardRate({
      organizationId: item.session.machine.organizationId,
      campaignId: item.session.campaignId,
      wasteTypeId: effectiveWasteTypeId,
    });
    const points = rate?.pointsPerItem ?? wasteType.defaultRewardPerItem ?? 0;
    const multiplier = item.session.campaign?.rewardMultiplier ?? 1;
    const unit = rate?.unit ?? wasteType.unit;
    const rewardAmount =
      unit === "KG"
        ? computeWeightBasedRewardAmount(points, item.measuredWeightGrams, multiplier)
        : computeRewardAmount(points, quantity, multiplier);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.depositItem.update({
        where: { id },
        data: {
          wasteTypeId: effectiveWasteTypeId,
          quantity,
          status: "ACCEPTED",
          complianceMultiplier: 1.0,
          baseRewardAmount: rewardAmount,
          rewardAmount,
          rewardRateId: rate?.id ?? null,
          validationReasonCode: "REVIEW_APPROVED",
          externalFraudFlag: false,
          acceptedAt: item.acceptedAt ?? new Date(),
        },
      });

      if (!earnEntry) {
        if (rewardAmount > 0) {
          await createEarnEntry(
            {
              userId: item.session.user.id,
              organizationId: item.session.machine.organizationId,
              sessionId: item.sessionId,
              depositItemId: item.id,
              campaignId: item.session.campaignId,
              amount: rewardAmount,
              status: "AVAILABLE",
              reasonCode: "REVIEW_APPROVED",
            },
            tx,
          );
        }
      } else {
        if (earnEntry.status === "PENDING") {
          await tx.rewardLedger.update({
            where: { id: earnEntry.id },
            data: { status: "AVAILABLE" },
          });
        }
        // Reviewer may change the classification/quantity, so the final
        // reward can differ from the amount already reserved. Top the
        // difference up (or down) with a separate append-only ADJUST row
        // instead of mutating the original entry's amount.
        const diff = rewardAmount - earnEntry.amount;
        if (diff !== 0) {
          await tx.rewardLedger.create({
            data: {
              userId: item.session.user.id,
              organizationId: item.session.machine.organizationId,
              sessionId: item.sessionId,
              depositItemId: item.id,
              entryType: "ADJUST",
              amount: diff,
              status: "AVAILABLE",
              reasonCode: "REVIEW_ADJUSTMENT",
              referenceType: "DepositItem",
              referenceId: item.id,
              actorId: user.id,
            },
          });
        }
      }

      return row;
    });

    await logAudit({
      actorId: user.id,
      action: "DEPOSIT_REVIEW_APPROVED",
      entityType: "DepositItem",
      entityId: id,
      metadata: {
        note: body.note,
        wasteTypeId: effectiveWasteTypeId,
        quantity,
        rewardAmount,
        previousReasonCode: item.validationReasonCode,
      },
    });

    return jsonOk({ item: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
