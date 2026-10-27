import { z } from "zod";
import { typeErrors } from "@/lib/zod-errors";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import {
  FUNDING_NOTE_MIN,
  FUNDING_NOTE_REQUIRED,
  FUNDING_REFERENCE_CONFLICT,
  FUNDING_REFERENCE_MIN,
  FUNDING_REFERENCE_REQUIRED,
  MAX_FUNDING_RUPIAH,
  getOrganizationFunding,
  isFundingReferenceConflict,
  recordFundingEntry,
  releaseResidualReservation,
} from "@/lib/reward-funding";
import { afterCommitSafely, runWalletTransaction } from "@/lib/wallet-service";

/**
 * Reward funding of one organization (B01a).
 *
 * GET: the funding view (confirmed cash, held obligations, capacity, campaign
 * budgets, recent entries, holds that need an operator). SUPERADMIN, or the
 * organization's own ADMIN (read-only).
 *
 * POST (SUPERADMIN only; never moves real money):
 * - `{ amount, reference, note, kind? }` records confirmed cash with its
 *   evidence: a reference of at least 6 characters, unique per kind across
 *   organizations (one bank transfer confirms cash once), and a note of at
 *   least 10 characters (source of funds, date, account) stored with the
 *   entry (`CONFIRMED_TOPUP`, positive, or a signed `CORRECTION`). Idempotent
 *   by reference: the same reference for the same organization and amount
 *   answers 200 with the existing entry; another organization or amount 409.
 * - `{ action: "release_reservation", reservationId, reason }` releases the
 *   residual hold of a session/trip that already ended (controller ruling:
 *   never by timeout). Audited with the reason.
 */

const entrySchema = z.object({
  action: z.literal("record_entry").optional(),
  kind: z.enum(["CONFIRMED_TOPUP", "CORRECTION"]).default("CONFIRMED_TOPUP"),
  amount: z
    .number({ error: typeErrors({ required: "Nominal wajib diisi", invalidType: "Nominal harus berupa angka" }) })
    .int("Nominal harus bilangan bulat rupiah")
    .min(-MAX_FUNDING_RUPIAH, "Nominal melebihi batas yang diizinkan")
    .max(MAX_FUNDING_RUPIAH, "Nominal melebihi batas yang diizinkan"),
  reference: z
    .string({ error: FUNDING_REFERENCE_REQUIRED })
    .trim()
    .min(FUNDING_REFERENCE_MIN, FUNDING_REFERENCE_REQUIRED)
    .max(120, "Referensi maksimal 120 karakter"),
  note: z
    .string({ error: FUNDING_NOTE_REQUIRED })
    .trim()
    .min(FUNDING_NOTE_MIN, FUNDING_NOTE_REQUIRED)
    .max(500, "Catatan maksimal 500 karakter"),
}).superRefine((value, ctx) => {
  if (value.kind === "CONFIRMED_TOPUP" && value.amount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Nominal topup harus lebih dari 0" });
  }
  if (value.kind === "CORRECTION" && value.amount === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Nominal koreksi tidak boleh 0" });
  }
});

const releaseSchema = z.object({
  action: z.literal("release_reservation"),
  reservationId: z.string().min(1, "reservationId wajib diisi").max(191),
  reason: z
    .string({ error: typeErrors({ required: "Alasan pelepasan sisa dana wajib diisi" }) })
    .trim()
    .min(3, "Alasan pelepasan sisa dana wajib diisi")
    .max(500, "Alasan maksimal 500 karakter"),
});

const bodySchema = z.union([releaseSchema, entrySchema]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    assertOrgScope(user, id);
    const funding = await getOrganizationFunding(id);
    if (!funding) throw new HttpError(404, "Organisasi tidak ditemukan");
    return jsonOk({ funding });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const organization = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!organization) throw new HttpError(404, "Organisasi tidak ditemukan");
    const body = bodySchema.parse(await req.json());

    if (body.action === "release_reservation") {
      const outcome = await runWalletTransaction((tx) =>
        releaseResidualReservation(tx, {
          organizationId: id,
          reservationId: body.reservationId,
          releasedById: user.id,
          reason: body.reason,
        }),
      );
      if (!outcome.idempotent) {
        await afterCommitSafely("audit REWARD_RESERVATION_RELEASE", () =>
          logAudit({
            actorId: user.id,
            action: "REWARD_RESERVATION_RELEASE",
            entityType: "RewardBudgetReservation",
            entityId: body.reservationId,
            metadata: {
              organizationId: id,
              businessKey: outcome.reservation.businessKey,
              sourceType: outcome.reservation.sourceType,
              sourceId: outcome.reservation.sourceId,
              releasedRupiah: outcome.released,
              reason: body.reason,
            },
          }),
        );
      }
      return jsonOk({ reservation: outcome.reservation, released: outcome.released, idempotent: outcome.idempotent });
    }

    let outcome: Awaited<ReturnType<typeof recordFundingEntry>>;
    try {
      outcome = await runWalletTransaction((tx) =>
        recordFundingEntry(tx, {
          organizationId: id,
          kind: body.kind,
          amount: body.amount,
          reference: body.reference,
          note: body.note,
          verifiedById: user.id,
        }),
      );
    } catch (error) {
      // C4: another organization committed the same reference while this
      // transaction waited on the unique index; nothing was written here.
      if (isFundingReferenceConflict(error)) throw new HttpError(409, FUNDING_REFERENCE_CONFLICT);
      throw error;
    }
    if (!outcome.idempotent) {
      await afterCommitSafely("audit REWARD_FUNDING_ENTRY", () =>
        logAudit({
          actorId: user.id,
          action: body.kind === "CONFIRMED_TOPUP" ? "REWARD_FUNDING_TOPUP" : "REWARD_FUNDING_CORRECTION",
          entityType: "FundingEntry",
          entityId: outcome.entry.id,
          metadata: {
            organizationId: id,
            amount: outcome.entry.amount,
            reference: outcome.entry.reference,
            confirmedRupiah: outcome.account.confirmedRupiah,
          },
        }),
      );
    }
    return jsonOk(
      { entry: outcome.entry, account: outcome.account, idempotent: outcome.idempotent },
      outcome.idempotent ? 200 : 201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
