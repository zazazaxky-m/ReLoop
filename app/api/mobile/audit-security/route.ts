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

    return jsonOk({ auditLogs, securityEvents, securitySummary });
  } catch (error) {
    return handleApiError(error);
  }
}
