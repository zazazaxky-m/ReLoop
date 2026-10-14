import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getWalletBalance } from "@/lib/ledger";
import { endDepositByOwner, sessionLimitsOf } from "@/lib/deposit-session-service";

const finishSchema = z.object({
  action: z.enum(["finish", "cancel"]),
});

const sessionDetail = {
  machine: { select: { name: true, machineCode: true } },
  campaign: { select: { name: true } },
  items: {
    include: { wasteType: { select: { name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;

    const session = await prisma.depositSession.findUnique({
      where: { id },
      include: sessionDetail,
    });

    if (!session) throw new HttpError(404, "Sesi tidak ditemukan");
    if (session.userId !== user.id) throw new HttpError(403, "Bukan sesi Anda");

    // B01b: the session's bound (admission snapshot), shown while depositing.
    return jsonOk({ session, limits: sessionLimitsOf(session) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Owner finish/cancel (R03, lib/deposit-session-service.ts): under User ->
 * Machine -> DepositSession locks; 409 while the machine still decides an
 * item (the session then ends once the item is decided, or by the timeout
 * policy). An ended session is returned unchanged.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;
    const body = finishSchema.parse(await req.json());

    const { session, changed } = await endDepositByOwner(user, id, body.action);
    if (!changed) return jsonOk({ session });

    const [updated, balance] = await Promise.all([
      prisma.depositSession.findUnique({ where: { id }, include: sessionDetail }),
      getWalletBalance(user.id),
    ]);
    return jsonOk({ session: updated ?? session, balance, limits: sessionLimitsOf(updated ?? session) });
  } catch (error) {
    return handleApiError(error);
  }
}
