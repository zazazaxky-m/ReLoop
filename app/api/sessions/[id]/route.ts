import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { transitionSession } from "@/lib/machine-state";
import { getWalletBalance } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";

const finishSchema = z.object({
  action: z.enum(["finish", "cancel"]),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;

    const session = await prisma.depositSession.findUnique({
      where: { id },
      include: {
        machine: { select: { name: true, machineCode: true } },
        campaign: { select: { name: true } },
        items: {
          include: { wasteType: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!session) throw new HttpError(404, "Sesi tidak ditemukan");
    if (session.userId !== user.id) throw new HttpError(403, "Bukan sesi Anda");

    return jsonOk({ session });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;
    const body = finishSchema.parse(await req.json());

    const session = await prisma.depositSession.findUnique({ where: { id } });
    if (!session) throw new HttpError(404, "Sesi tidak ditemukan");
    if (session.userId !== user.id) throw new HttpError(403, "Bukan sesi Anda");

    if (["COMPLETED", "CANCELLED", "EXPIRED"].includes(session.status)) {
      return jsonOk({ session });
    }

    const nextStatus =
      body.action === "cancel"
        ? "CANCELLED"
        : transitionSession(session.status, "FINISH");

    await prisma.depositSession.update({
      where: { id },
      data: {
        status: nextStatus,
        completedAt: new Date(),
      },
    });

    await logAudit({
      actorId: user.id,
      action: body.action === "cancel" ? "DEPOSIT_SESSION_CANCEL" : "DEPOSIT_SESSION_FINISH",
      entityType: "DepositSession",
      entityId: id,
    });

    const [updated, balance] = await Promise.all([
      prisma.depositSession.findUnique({
        where: { id },
        include: {
          machine: { select: { name: true, machineCode: true } },
          campaign: { select: { name: true } },
          items: {
            include: { wasteType: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      getWalletBalance(user.id),
    ]);
    return jsonOk({ session: updated, balance });
  } catch (error) {
    return handleApiError(error);
  }
}
