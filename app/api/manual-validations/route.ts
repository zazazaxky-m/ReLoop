import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, assertActivePartnership, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { canValidateTripStage, getTripTravelAgentGateBlockReason } from "@/lib/trip";
import {
  BAG_IDS_REQUIRED,
  TRIP_CHANGED,
  assertCountWithinIssued,
  lockTripAggregate,
  markUnreviewedBagsNotReturned,
  refreshTripOutcome,
  tripNotificationRecipients,
  validateTripBags,
} from "@/lib/trip-validation";
import { afterCommitSafely, runWalletTransaction } from "@/lib/wallet-service";
import { calculateCompliance } from "@/lib/tourism";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { formatRupiah } from "@/lib/format";

const conditionSchema = z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"]);

const createSchema = z.object({
  tripId: z.string().min(1),
  validationStage: z.enum(["CHECK_IN", "CHECK_OUT", "BANK_SAMPAH_PICKUP"]).default("CHECK_OUT"),
  gateType: z.enum(["ENTRY", "EXIT", "BANK_SAMPAH"]).optional(),
  bagQrCode: z.string().max(60).optional(),
  returnedBagCount: z.number().int().min(0).max(500).default(0),
  actualWeightKg: z.number().min(0).max(100000).nullable().optional(),
  conditionStatus: conditionSchema.optional(),
  appCompleted: z.boolean().default(false),
  notes: z.string().max(500).optional(),
  bags: z.array(z.object({ id: z.string().min(1).max(191), status: conditionSchema })).max(2000).optional(),
});

/**
 * Gate validation of a trip. Check-out is decided in one wallet transaction
 * under the trip locks (lib/trip-validation.ts): bag IDs are verified as rows
 * of this trip, the outcome is recomputed from every bag, and the return
 * earning is written at most once (`trip:<tripId>:return`). A reward trip is
 * never paid from a bare count. Audit and notifications run after COMMIT.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    // Scope uses only the trip's immutable campaign organization; every
    // decision below is re-read under the locks.
    const scope = await prisma.trip.findUnique({
      where: { id: data.tripId },
      select: { id: true, campaign: { select: { organizationId: true } } },
    });
    if (!scope) throw new HttpError(404, "Trip tidak ditemukan");
    if (user.role === "PENGEPUL") {
      await assertActivePartnership(user.id, scope.campaign.organizationId);
      if (data.validationStage !== "BANK_SAMPAH_PICKUP") {
        throw new HttpError(403, "Pengepul hanya dapat mencatat pickup Bank Sampah");
      }
    } else {
      assertOrgScope(user, scope.campaign.organizationId);
    }
    const bags = data.bags ?? [];
    if (bags.length > 0 && data.validationStage !== "CHECK_OUT") {
      throw new HttpError(422, "Kondisi kantong hanya dicatat saat check-out");
    }

    const result = await runWalletTransaction(async (tx) => {
      const trip = await lockTripAggregate(tx, scope.id);
      const issued = trip.bagAssignments.length;

      // Gate ops require an invited agent; bank-sampah pickup after COMPLETED is allowed even if later suspended.
      if (data.validationStage !== "BANK_SAMPAH_PICKUP") {
        const agentBlock = await getTripTravelAgentGateBlockReason(
          { travelAgentId: trip.travelAgentId, organizationId: trip.campaign.organizationId }, tx);
        if (agentBlock) throw new HttpError(422, agentBlock);
      }
      const stageGuard = canValidateTripStage(trip.status, data.validationStage);
      if (!stageGuard.ok) throw new HttpError(422, stageGuard.reason!);

      if (data.validationStage === "BANK_SAMPAH_PICKUP") {
        const existingPickup = await tx.manualValidation.findFirst({
          where: { tripId: trip.id, validationStage: "BANK_SAMPAH_PICKUP" },
          select: { id: true },
        });
        if (existingPickup) throw new HttpError(422, "Pickup bank sampah untuk trip ini sudah dicatat");
      }
      if (data.bagQrCode && !trip.bagAssignments.some((bag) => bag.bagQrCode === data.bagQrCode)) {
        throw new HttpError(422, "QR trash bag tidak valid untuk trip ini");
      }

      const record = (fields: {
        returnedBagCount: number;
        conditionStatus: z.infer<typeof conditionSchema> | null;
        complianceScore: number;
        complianceStatus: ReturnType<typeof calculateCompliance>["status"];
      }) =>
        tx.manualValidation.create({
          data: {
            tripId: trip.id,
            validatedById: user.id,
            validationStage: data.validationStage,
            gateType:
              data.gateType ??
              (data.validationStage === "CHECK_IN"
                ? "ENTRY"
                : data.validationStage === "CHECK_OUT"
                  ? "EXIT"
                  : "BANK_SAMPAH"),
            bagQrCode: data.bagQrCode ?? null,
            actualWeightKg: data.actualWeightKg ?? null,
            appCompleted: data.appCompleted,
            notes: data.notes ?? null,
            ...fields,
          },
        });

      if (data.validationStage === "CHECK_OUT" && bags.length > 0) {
        // Verified rows only; unlisted unscanned bags did not come back.
        await validateTripBags(tx, trip.id, bags);
        await markUnreviewedBagsNotReturned(tx, trip.id);
        const outcome = await refreshTripOutcome(tx, trip.id, { appCompleted: data.appCompleted });
        if (!outcome.completedNow) throw new HttpError(409, TRIP_CHANGED);
        const validation = await record({
          returnedBagCount: outcome.returnedCount,
          conditionStatus: outcome.conditionStatus,
          complianceScore: outcome.compliance.score,
          complianceStatus: outcome.compliance.status,
        });
        return { trip, validation, compliance: outcome.compliance, rewardAmount: outcome.rewardAmount };
      }

      // Legacy count-only request: bounded by the issued rows, never stamps a
      // bag status and never earns money.
      assertCountWithinIssued(data.returnedBagCount, issued);
      if (
        data.validationStage === "CHECK_OUT" &&
        trip.campaign.rewardMode === "MONEY_REWARD" &&
        trip.userId &&
        issued > 0
      ) {
        throw new HttpError(422, BAG_IDS_REQUIRED);
      }
      const compliance = calculateCompliance({
        stage: data.validationStage,
        appCompleted: data.appCompleted,
        assignedBagCount: issued,
        returnedBagCount: data.returnedBagCount,
        conditionStatus: data.conditionStatus,
      });
      if (data.validationStage !== "BANK_SAMPAH_PICKUP") {
        const { count } = await tx.trip.updateMany({
          where: { id: trip.id, status: trip.status },
          data:
            data.validationStage === "CHECK_IN"
              ? { status: "ACTIVE", complianceStatus: "CHECKED_IN", complianceScore: compliance.score, checkInAt: new Date() }
              : { status: "COMPLETED", complianceStatus: compliance.status, complianceScore: compliance.score, checkOutAt: new Date() },
        });
        if (count !== 1) throw new HttpError(409, TRIP_CHANGED);
      }
      const validation = await record({
        returnedBagCount: data.returnedBagCount,
        conditionStatus: data.conditionStatus ?? null,
        complianceScore: compliance.score,
        complianceStatus: compliance.status,
      });
      return { trip, validation, compliance, rewardAmount: 0 };
    });

    const { trip, validation, compliance, rewardAmount } = result;
    await afterCommitSafely("audit MANUAL_VALIDATION", () =>
      logAudit({
        actorId: user.id,
        action: "MANUAL_VALIDATION",
        entityType: "ManualValidation",
        entityId: validation.id,
        metadata: { tripId: trip.id, rewardAmount },
      }),
    );

    // Best-effort in-app notifications for trip stakeholders.
    const recipients = await tripNotificationRecipients(trip);
    const groupLabel = trip.groupName ?? trip.campaign.name;
    const stageLabel =
      data.validationStage === "CHECK_IN"
        ? "check-in"
        : data.validationStage === "CHECK_OUT"
          ? "check-out"
          : "pickup bank sampah";
    for (const userId of recipients) {
      await afterCommitSafely("notification TRIP_STATUS", () =>
        createNotification({
          userId,
          type: "TRIP_STATUS",
          title: `Trip ${stageLabel}`,
          body: `${groupLabel}: status ${stageLabel} tercatat (skor ${compliance.score}/100).`,
          data: { tripId: trip.id, stage: data.validationStage },
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

    return jsonOk({ validation, rewardAmount, compliance }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
