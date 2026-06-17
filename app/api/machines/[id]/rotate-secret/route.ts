import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { generateIngestSecret } from "@/lib/machine-auth";
import { logAudit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;

    const machine = await prisma.machine.findUnique({ where: { id } });
    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");

    const ingestSecret = generateIngestSecret();
    await prisma.machine.update({ where: { id }, data: { ingestSecret } });

    await logAudit({
      actorId: user.id,
      action: "MACHINE_ROTATE_SECRET",
      entityType: "Machine",
      entityId: id,
      metadata: { machineCode: machine.machineCode },
    });

    // Returned once so the operator can configure the device/simulator.
    return jsonOk({ ingestSecret });
  } catch (error) {
    return handleApiError(error);
  }
}
