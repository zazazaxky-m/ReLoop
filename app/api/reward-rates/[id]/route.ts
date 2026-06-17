import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  active: z.boolean(),
});

async function loadEditable(id: string, role: string, orgId: string | null) {
  const rate = await prisma.rewardRate.findUnique({
    where: { id },
    include: { campaign: { select: { organizationId: true } } },
  });
  if (!rate) throw new HttpError(404, "Tarif tidak ditemukan");
  if (role === "SUPERADMIN") return rate;
  const rateOrg = rate.organizationId ?? rate.campaign?.organizationId ?? null;
  if (rateOrg == null) {
    throw new HttpError(403, "Tarif global hanya dapat diubah superadmin");
  }
  if (rateOrg !== orgId) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  return rate;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadEditable(id, user.role, user.organizationId);
    const { active } = patchSchema.parse(await req.json());

    const rate = await prisma.rewardRate.update({
      where: { id },
      data: {
        active,
        effectiveTo: active ? null : new Date(),
      },
    });

    await logAudit({
      actorId: user.id,
      action: active ? "REWARD_RATE_ACTIVATE" : "REWARD_RATE_DEACTIVATE",
      entityType: "RewardRate",
      entityId: id,
    });

    return jsonOk({ rate });
  } catch (error) {
    return handleApiError(error);
  }
}
