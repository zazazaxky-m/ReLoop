import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(40).nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser();
    const data = patchSchema.parse(await req.json());

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
      },
    });

    const { passwordHash, ...safeUser } = updated as any;
    return jsonOk({ user: { ...safeUser, role: updated.role } });
  } catch (error) {
    return handleApiError(error);
  }
}
