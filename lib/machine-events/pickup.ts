import type { Prisma } from "@prisma/client";
import { PICKUP_OPEN } from "../pickup";
import { notifyOrgAdmins } from "./fraud";

/** Raises a FULL pickup request once per open cycle (idempotent per machine). */
export async function maybeCreateAutoPickup(
  tx: Prisma.TransactionClient,
  machine: { id: string; organizationId: string },
  machineCode: string,
) {
  const open = await tx.pickupRequest.findFirst({
    where: { machineId: machine.id, status: { in: PICKUP_OPEN } },
  });
  if (open) return;
  await tx.pickupRequest.create({
    data: {
      machineId: machine.id,
      organizationId: machine.organizationId,
      reason: "FULL",
      priority: 1,
      status: "REQUESTED",
      notes: "Auto-generated: mesin penuh / mendekati penuh.",
    },
  });
  // Piggybacks on the same "once per open cycle" guard above so admins
  // aren't paged on every heartbeat while the machine stays FULL.
  await notifyOrgAdmins(machine.organizationId, {
    type: "MACHINE_FULL",
    title: "Mesin penuh",
    body: `Mesin ${machineCode} sudah penuh dan menunggu pickup.`,
    data: { machineId: machine.id },
  });
}
