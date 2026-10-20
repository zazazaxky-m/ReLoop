import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getTripTravelAgentGateBlockReason } from "@/lib/trip";
import { issueTrashBags } from "@/lib/trip-issuance";
import {
  CORRECTION_REQUIRED,
  lockTripAggregate,
  refreshTripOutcome,
  tripNotificationRecipients,
  validateTripBags,
} from "@/lib/trip-validation";
import { afterCommitSafely, runWalletTransaction } from "@/lib/wallet-service";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { formatRupiah } from "@/lib/format";

const createSchema = z.object({
  tripId: z.string().min(1),
  bagCount: z.number().int().min(1).max(200),
  wasteTypeId: z.string().min(1).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1).optional(),
  qrCode: z.string().min(1).max(60).optional(),
  status: z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"]),
  appCompleted: z.boolean().default(true),
  actualWeightKg: z.number().min(0).max(100000).nullable().optional(),
  notes: z.string().max(500).optional(),
  /** Required to change a bag after the trip is COMPLETED (never changes the reward). */
  correctionReason: z.string().trim().min(5).max(500).optional(),
});

const BAG_RESPONSE_INCLUDE = {
  wasteType: { select: { name: true } },
  trip: {
    select: {
      id: true,
      status: true,
      groupName: true,
      leaderName: true,
      participantCount: true,
      complianceStatus: true,
      campaign: { select: { organizationId: true, name: true } },
      travelAgent: { select: { name: true } },
    },
  },
} as const;

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get("tripId");
    const qrCode = searchParams.get("qrCode");

    if (!tripId && !qrCode) {
      throw new HttpError(400, "tripId atau qrCode harus diisi");
    }

    const where: any = {};
    if (tripId) where.tripId = tripId;
    if (qrCode) where.bagQrCode = qrCode;

    const bags = await prisma.trashBagAssignment.findMany({
      where,
      orderBy: { assignedAt: "asc" },
      include: {
        wasteType: { select: { name: true } },
        trip: {
          select: {
            id: true,
            groupName: true,
            leaderName: true,
            participantCount: true,
            complianceStatus: true,
            campaign: { select: { organizationId: true, name: true } },
            travelAgent: { select: { name: true } },
            status: true,
          },
        },
      },
    });

    if (bags.length > 0) {
      const orgId = bags[0].trip.campaign.organizationId;
      assertOrgScope(user, orgId);
    }

    return jsonOk({ bags });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Issues bags for a trip (lib/trip-issuance.ts): under the reward recipient's
 * User -> funding account -> Campaign -> Trip locks, reserving the most the
 * bags can pay before the rows exist (B01).
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());
    const created = await issueTrashBags(user, data);
    return jsonOk({ bags: created }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Progressive per-bag scan. Runs in one wallet transaction under the trip
 * locks (reward User -> Trip -> bags) and recomputes the trip from every bag
 * row (lib/trip-validation.ts), so the last two bags scanned in parallel
 * still close the trip exactly once and earn exactly once.
 *
 * - ACTIVE trip: the bag is updated; a repeated identical scan writes
 *   nothing and answers `idempotent: true`. Only the scan that reviews the
 *   last unreviewed bag closes the trip (COMPLETED, one CHECK_OUT validation,
 *   the return earning `trip:<tripId>:return` written once). An ACTIVE trip
 *   whose bags were all reviewed before the scan is legacy state (EX-02): no
 *   scan closes or pays it; that needs an explicit bulk check-out with IDs.
 * - COMPLETED trip: an identical scan is an idempotent replay. A different
 *   status needs `correctionReason`; the correction updates the bag and the
 *   trip compliance, is audited with the paid and recomputed reward, and never
 *   mints, adjusts or reverses money.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = updateSchema.parse(await req.json());
    if (!data.id && !data.qrCode) {
      throw new HttpError(422, "id atau qrCode wajib diisi");
    }

    // Bag -> trip -> organization never changes; everything else is re-read under the locks.
    const found = await prisma.trashBagAssignment.findFirst({
      where: data.id ? { id: data.id } : { bagQrCode: data.qrCode },
      select: { id: true, tripId: true, trip: { select: { campaign: { select: { organizationId: true } } } } },
    });
    if (!found) throw new HttpError(404, "Trash bag tidak ditemukan");
    assertOrgScope(user, found.trip.campaign.organizationId);

    const result = await runWalletTransaction(async (tx) => {
      const trip = await lockTripAggregate(tx, found.tripId);
      const before = trip.bagAssignments.find((bag) => bag.id === found.id);
      if (!before) throw new HttpError(404, "Trash bag tidak ditemukan");

      if (trip.status === "CANCELLED") throw new HttpError(422, "Trip sudah dibatalkan");
      if (trip.status === "PLANNED") {
        throw new HttpError(422, "Lakukan check-in terlebih dahulu sebelum scan kondisi kantong");
      }
      if (trip.status !== "ACTIVE" && trip.status !== "COMPLETED") {
        throw new HttpError(422, "Scan kantong hanya untuk trip PLANNED atau ACTIVE");
      }
      const unchanged = before.status === data.status;
      const loadBag = () => tx.trashBagAssignment.findUniqueOrThrow({ where: { id: found.id }, include: BAG_RESPONSE_INCLUDE });

      if (trip.status === "COMPLETED") {
        if (unchanged) {
          return {
            trip, bag: await loadBag(), validation: null, rewardAmount: 0, idempotent: true, completedNow: false,
            compliance: { score: trip.complianceScore, status: trip.complianceStatus }, correction: null,
          };
        }
        if (!data.correctionReason) throw new HttpError(422, CORRECTION_REQUIRED);
        await validateTripBags(tx, trip.id, [{ id: found.id, status: data.status }]);
        const outcome = await refreshTripOutcome(tx, trip.id);
        return {
          trip, bag: await loadBag(), validation: null, rewardAmount: 0, idempotent: false, completedNow: false,
          compliance: outcome.compliance,
          correction: {
            previousStatus: before.status,
            reason: data.correctionReason,
            paidRewardAmount: outcome.paidRewardAmount,
            recomputedRewardAmount: outcome.computedRewardAmount,
          },
        };
      }

      const agentBlock = await getTripTravelAgentGateBlockReason(
        { travelAgentId: trip.travelAgentId, organizationId: trip.campaign.organizationId }, tx);
      if (agentBlock) throw new HttpError(422, agentBlock);

      if (unchanged) {
        // Idempotent replay: nothing is written, and a legacy fully-reviewed
        // trip is never closed or paid by it.
        return {
          trip, bag: await loadBag(), validation: null, rewardAmount: 0, idempotent: true, completedNow: false,
          compliance: { score: trip.complianceScore, status: trip.complianceStatus }, correction: null,
        };
      }
      await validateTripBags(tx, trip.id, [{ id: found.id, status: data.status }]);
      // Only reviewing a previously unreviewed bag may close the trip; changing
      // an already-reviewed bag never closes it (legacy trips need a bulk check-out).
      const outcome = await refreshTripOutcome(tx, trip.id, {
        appCompleted: data.appCompleted,
        mayClose: before.status === null,
      });

      // Avoid noisy per-bag CHECK_OUT rows: only the scan that closes the trip records the gate validation.
      const validation = outcome.completedNow
        ? await tx.manualValidation.create({
            data: {
              tripId: trip.id,
              validatedById: user.id,
              validationStage: "CHECK_OUT",
              gateType: "EXIT",
              bagQrCode: before.bagQrCode,
              returnedBagCount: outcome.returnedCount,
              actualWeightKg: data.actualWeightKg ?? null,
              conditionStatus: outcome.conditionStatus,
              appCompleted: data.appCompleted,
              complianceScore: outcome.compliance.score,
              complianceStatus: outcome.compliance.status,
              notes: data.notes ?? null,
            },
          })
        : null;
      return {
        trip, bag: await loadBag(), validation, rewardAmount: outcome.rewardAmount,
        idempotent: false, completedNow: outcome.completedNow,
        compliance: outcome.compliance, correction: null,
      };
    });

    const { trip, bag, validation, rewardAmount, idempotent, completedNow, compliance, correction } = result;
    if (correction) {
      await afterCommitSafely("audit TRASH_BAG_CORRECTION", () =>
        logAudit({
          actorId: user.id,
          action: "TRASH_BAG_CORRECTION",
          entityType: "TrashBagAssignment",
          entityId: bag.id,
          metadata: {
            tripId: trip.id,
            previousStatus: correction.previousStatus,
            status: data.status,
            reason: correction.reason,
            compliance,
            // The paid reward stays; finance follows up any difference.
            paidRewardAmount: correction.paidRewardAmount,
            recomputedRewardAmount: correction.recomputedRewardAmount,
          },
        }),
      );
    } else if (!idempotent) {
      await afterCommitSafely("audit TRASH_BAG_SCAN_UPDATE", () =>
        logAudit({
          actorId: user.id,
          action: "TRASH_BAG_SCAN_UPDATE",
          entityType: "TrashBagAssignment",
          entityId: bag.id,
          metadata: { qrCode: bag.bagQrCode, status: data.status, compliance, rewardAmount },
        }),
      );
    }

    if (completedNow) {
      const groupLabel = trip.groupName ?? trip.campaign.name ?? "Trip";
      for (const userId of await tripNotificationRecipients(trip)) {
        await afterCommitSafely("notification TRIP_STATUS", () =>
          createNotification({
            userId,
            type: "TRIP_STATUS",
            title: "Trip check-out",
            body: `${groupLabel}: check-out selesai (skor ${compliance.score}/100).`,
            data: { tripId: trip.id, stage: "CHECK_OUT" },
          }),
        );
        if (rewardAmount > 0 && userId === trip.userId) {
          await afterCommitSafely("notification TRASH_BAG_REWARD", () =>
            createNotification({
              userId,
              type: "TRASH_BAG_REWARD",
              title: "Reward trash bag masuk",
              body: `${formatRupiah(rewardAmount)} dari trip ${groupLabel} sudah tersedia di dompet.`,
              data: { tripId: trip.id, rewardAmount },
            }),
          );
        }
      }
    }

    return jsonOk({
      bag,
      validation,
      compliance,
      rewardAmount,
      idempotent,
      ...(correction
        ? {
            correction: {
              previousStatus: correction.previousStatus,
              paidRewardAmount: correction.paidRewardAmount,
              recomputedRewardAmount: correction.recomputedRewardAmount,
            },
          }
        : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
