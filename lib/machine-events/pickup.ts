import type { Prisma } from "@prisma/client";
import { PICKUP_OPEN, PICKUP_REPLACEABLE } from "../pickup";
import { notifyOrgAdmins } from "./fraud";

/**
 * Raises a FULL pickup request once per open cycle (idempotent per machine).
 * With `afterCommit`, the admin notification is deferred until the caller's
 * transaction commits.
 *
 * B05: when the machine's latest task was cancelled or failed and has no
 * replacement yet, this request is recorded as its replacement
 * (`replacesPickupId`), so the admin's reassignment path stays linked. Every
 * caller has already updated the Machine row in `tx` (HEARTBEAT,
 * STATUS_CHANGED, FILL_LEVEL_UPDATED), so it holds the Machine lock that
 * lib/pickup-dispatch.ts createReplacementPickup also takes first: the two
 * never link the same task twice.
 */
export async function maybeCreateAutoPickup(
  tx: Prisma.TransactionClient,
  machine: { id: string; organizationId: string },
  machineCode: string,
  afterCommit?: (effect: () => Promise<void>) => void,
) {
  const open = await tx.pickupRequest.findFirst({
    where: { machineId: machine.id, status: { in: PICKUP_OPEN } },
  });
  if (open) return;
  const latest = await tx.pickupRequest.findFirst({
    where: { machineId: machine.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, replacedBy: { select: { id: true } } },
  });
  const replacesPickupId =
    latest && PICKUP_REPLACEABLE.includes(latest.status) && !latest.replacedBy ? latest.id : null;
  await tx.pickupRequest.create({
    data: {
      machineId: machine.id,
      organizationId: machine.organizationId,
      reason: "FULL",
      priority: 1,
      status: "REQUESTED",
      notes: "Auto-generated: mesin penuh / mendekati penuh.",
      replacesPickupId,
    },
  });
  // Piggybacks on the same "once per open cycle" guard above so admins
  // aren't paged on every heartbeat while the machine stays FULL.
  const notify = () =>
    notifyOrgAdmins(machine.organizationId, {
      type: "MACHINE_FULL",
      title: "Mesin penuh",
      body: `Mesin ${machineCode} sudah penuh dan menunggu pickup.`,
      data: { machineId: machine.id },
    });
  if (afterCommit) afterCommit(notify);
  else await notify();
}
