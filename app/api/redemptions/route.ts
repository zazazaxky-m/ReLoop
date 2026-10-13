import { randomUUID } from "node:crypto";
import type { Prisma, Redemption } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { redemptionRequestSchema, requestRedemption } from "@/lib/wallet-service";
import { displayUsers } from "@/lib/display-user";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

/** requestHash is an internal idempotency detail; responses stay as before. */
function publicRedemption({ requestHash: _requestHash, ...redemption }: Redemption) {
  return redemption;
}

const ACTIVE_QUEUE = ["REQUESTED", "APPROVED", "PROCESSING"] as const;

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["USER", "SUPERADMIN"]);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const queueOnly = url.searchParams.get("queue") === "1";

    const pagination = parsePagination(url);

    const where: Prisma.RedemptionWhereInput = {};
    if (user.role === "USER") where.userId = user.id;
    if (statusFilter) where.status = statusFilter as Prisma.EnumRedemptionStatusFilter["equals"];
    else if (queueOnly) where.status = { in: [...ACTIVE_QUEUE] };

    const [total, redemptions] = await Promise.all([
      prisma.redemption.count({ where }),
      prisma.redemption.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        omit: { requestHash: true },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

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

    return jsonOk({
      redemptions: enriched,
      pagination: buildPaginationMeta(total, pagination),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Requests a payout. The balance check, reserve and idempotency decision run in
 * one transaction under the user's row lock (lib/wallet-service.ts).
 *
 * Clients should send one `idempotencyKey` per logical request and reuse it on
 * retry. Legacy clients may omit it: the server generates one and returns it as
 * `idempotencyKey` so the client can retry safely.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const data = redemptionRequestSchema.parse(await req.json());
    const idempotencyKey = data.idempotencyKey ?? randomUUID();

    const { redemption, idempotent } = await requestRedemption(user, {
      amount: data.amount,
      payoutAccountId: data.payoutAccountId,
      idempotencyKey,
    });

    return jsonOk(
      { redemption: publicRedemption(redemption), idempotent, idempotencyKey: redemption.idempotencyKey },
      idempotent ? 200 : 201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
