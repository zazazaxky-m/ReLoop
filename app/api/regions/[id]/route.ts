import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  type: z.enum(["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"]).optional(),
  parentId: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const existing = await prisma.region.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Wilayah tidak ditemukan");
    const data = patchSchema.parse(await req.json());

    // Cegah cycle pada parentId.
    if (data.parentId && data.parentId !== existing.parentId) {
      if (data.parentId === id) {
        throw new HttpError(422, "Wilayah tidak boleh menjadi induk dirinya sendiri");
      }
      const parent = await prisma.region.findUnique({
        where: { id: data.parentId },
      });
      if (!parent) throw new HttpError(404, "Wilayah induk tidak ditemukan");
      // Pastikan parent bukan turunan dari region ini.
      let cursor: string | null = data.parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          throw new HttpError(422, "Tidak boleh membuat siklus pada hierarki wilayah");
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const p: { parentId: string | null } | null =
          await prisma.region.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
        cursor = p?.parentId ?? null;
      }
    }

    const region = await prisma.region.update({ where: { id }, data });
    await logAudit({
      actorId: user.id,
      action: "REGION_UPDATE",
      entityType: "Region",
      entityId: id,
      metadata: data,
    });
    return jsonOk({ region });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const existing = await prisma.region.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            organizations: true,
            machines: true,
          },
        },
      },
    });
    if (!existing) throw new HttpError(404, "Wilayah tidak ditemukan");
    const usage =
      existing._count.children +
      existing._count.organizations +
      existing._count.machines;
    if (usage > 0) {
      throw new HttpError(
        409,
        `Wilayah tidak dapat dihapus karena masih digunakan oleh ${usage} entitas lain. Pindahkan atau hapus terlebih dahulu.`,
      );
    }
    await prisma.region.delete({ where: { id } });
    await logAudit({
      actorId: user.id,
      action: "REGION_DELETE",
      entityType: "Region",
      entityId: id,
      metadata: { name: existing.name, type: existing.type },
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
