import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getWalletBalance, createRedeemReserve } from "@/lib/ledger";
import { getMinRedemption } from "@/lib/config";
import { logAudit } from "@/lib/audit";
import { displayUsers } from "@/lib/display-user";

const createSchema = z.object({
  amount: z.number().int().positive(),
  payoutAccountId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

const ACTIVE_QUEUE = ["REQUESTED", "APPROVED", "PROCESSING"] as const;

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["USER", "SUPERADMIN"]);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const queueOnly = url.searchParams.get("queue") === "1";

    const where: Prisma.RedemptionWhereInput = {};
    if (user.role === "USER") where.userId = user.id;
    if (statusFilter) where.status = statusFilter as Prisma.EnumRedemptionStatusFilter["equals"];
    else if (queueOnly) where.status = { in: [...ACTIVE_QUEUE] };

    const redemptions = await prisma.redemption.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Attach the payout account snapshot (no FK relation in schema).
    const accountIds = redemptions.map((r) => r.payoutAccountId).filter(Boolean) as string[];
    const accounts = accountIds.length
      ? await prisma.payoutAccount.findMany({ where: { id: { in: accountIds } } })
      : [];
    const accById = new Map(accounts.map((a) => [a.id, a]));

    const enriched = redemptions.map((r) => ({
      ...r,
      user: r.user ? displayUsers([r.user])[0] : r.user,
      payoutAccount: r.payoutAccountId ? (accById.get(r.payoutAccountId) ?? null) : null,
    }));

    return jsonOk({ redemptions: enriched });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const data = createSchema.parse(await req.json());

    if (data.idempotencyKey) {
      const existing = await prisma.redemption.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existing) return jsonOk({ redemption: existing, idempotent: true });
    }

    const account = await prisma.payoutAccount.findUnique({
      where: { id: data.payoutAccountId },
    });
    if (!account || account.userId !== user.id) {
      throw new HttpError(404, "Akun pencairan tidak ditemukan");
    }
    if (account.status === "DISABLED") {
      throw new HttpError(409, "Akun pencairan dinonaktifkan");
    }

    const minRedemption = await getMinRedemption();
    if (data.amount < minRedemption) {
      return jsonError(422, `Minimum pencairan Rp${minRedemption.toLocaleString("id-ID")}`);
    }

    const balance = await getWalletBalance(user.id);
    if (balance.available < data.amount) {
      return jsonError(422, "Saldo tersedia tidak mencukupi");
    }

    const idempotencyKey = data.idempotencyKey ?? randomUUID();

    const redemption = await prisma.$transaction(async (tx) => {
      const created = await tx.redemption.create({
        data: {
          userId: user.id,
          provider: account.provider,
          payoutAccountId: account.id,
          amount: data.amount,
          method: "MANUAL_TRANSFER",
          status: "REQUESTED",
          idempotencyKey,
        },
      });
      await createRedeemReserve(
        { userId: user.id, amount: data.amount, redemptionId: created.id, provider: account.provider },
        tx,
      );
      return created;
    });

    await logAudit({
      actorId: user.id,
      action: "REDEMPTION_REQUEST",
      entityType: "Redemption",
      entityId: redemption.id,
      metadata: { amount: data.amount, provider: account.provider },
    });

    return jsonOk({ redemption }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
