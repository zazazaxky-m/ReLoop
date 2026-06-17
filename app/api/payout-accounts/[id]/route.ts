import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  accountName: z.string().max(120).optional(),
  status: z.enum(["UNVERIFIED", "DISABLED"]).optional(),
});

async function loadOwned(id: string, userId: string) {
  const account = await prisma.payoutAccount.findUnique({ where: { id } });
  if (!account) throw new HttpError(404, "Akun pencairan tidak ditemukan");
  if (account.userId !== userId) throw new HttpError(403, "Bukan akun Anda");
  return account;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;
    await loadOwned(id, user.id);
    const data = patchSchema.parse(await req.json());

    const account = await prisma.payoutAccount.update({ where: { id }, data });
    await logAudit({
      actorId: user.id,
      action: "PAYOUT_ACCOUNT_UPDATE",
      entityType: "PayoutAccount",
      entityId: id,
      metadata: data,
    });
    return jsonOk({ account });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER"]);
    const { id } = await params;
    await loadOwned(id, user.id);

    // Soft-disable to preserve any redemption references.
    await prisma.payoutAccount.update({ where: { id }, data: { status: "DISABLED" } });
    await logAudit({
      actorId: user.id,
      action: "PAYOUT_ACCOUNT_DISABLE",
      entityType: "PayoutAccount",
      entityId: id,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
