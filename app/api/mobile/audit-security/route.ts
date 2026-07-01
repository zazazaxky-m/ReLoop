import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/rbac";
import { getSecurityEvents, getSecuritySummary } from "@/lib/security-events";

export async function GET(req: Request) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const url = new URL(req.url);
    const take = Math.min(
      Math.max(Number(url.searchParams.get("take") ?? 50), 1),
      200,
    );
    const machineId = url.searchParams.get("machineId") ?? undefined;

    const [auditLogs, securityEvents, securitySummary] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take,
      }),
      getSecurityEvents({ take, machineId }),
      getSecuritySummary(),
    ]);

    // Ambil data actor (nama & role) untuk audit logs yang punya actorId
    const actorIds = Array.from(
      new Set(
        auditLogs.map((l) => l.actorId).filter((x): x is string => Boolean(x)),
      ),
    );
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, role: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a]));

    const enrichedLogs = auditLogs.map((l) => ({
      ...l,
      actor: l.actorId ? actorById.get(l.actorId) ?? null : null,
    }));

    return jsonOk({
      auditLogs: enrichedLogs,
      securityEvents,
      securitySummary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
