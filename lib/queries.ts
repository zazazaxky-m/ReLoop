import { prisma } from "./prisma";

export async function wasteTypeOptions(organizationId?: string | null) {
  const where = organizationId
    ? { active: true, OR: [{ organizationId: null }, { organizationId }] }
    : { active: true };
  return prisma.wasteType.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function regionOptions() {
  const list = await prisma.region.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true },
  });
  return list.map((r) => ({ id: r.id, name: `${r.name} (${r.type})` }));
}

export async function organizationOptions() {
  return prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function campaignOptions(organizationId?: string | null) {
  return prisma.campaign.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
}
