import type { Prisma } from "@prisma/client";
import {
  UNKNOWN_WASTE_TYPE_NAME,
  type IngestEventInput,
} from "./shared";

/**
 * Finds (or lazily creates) the shared inactive "unknown" WasteType used as
 * a fallback target so ITEM_DETECTED never fails to create a DepositItem.
 */
export async function resolveOrCreateUnknownWasteType(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const existing = await tx.wasteType.findFirst({
    where: { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.wasteType.create({
    data: {
      name: UNKNOWN_WASTE_TYPE_NAME,
      unit: "ITEM",
      active: false,
      description:
        "Dibuat otomatis oleh sistem untuk setoran tanpa jenis sampah yang valid. Tinjau dan klasifikasikan ulang melalui antrean peninjauan.",
    },
    select: { id: true },
  });
  return created.id;
}

export async function resolveFraudDepositItemId(
  tx: Prisma.TransactionClient,
  input: IngestEventInput,
): Promise<string | null> {
  if (input.depositItemId) return input.depositItemId;
  if (!input.sessionId) return null;
  const item = await tx.depositItem.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return item?.id ?? null;
}

import type { DepositItemCache } from "./item-cache";

export async function resolveDepositItemId(
  tx: Prisma.TransactionClient,
  input: IngestEventInput,
  cache?: DepositItemCache,
): Promise<string | null> {
  if (input.depositItemId) {
    if (input.sessionId) cache?.set(input.sessionId, input.depositItemId);
    return input.depositItemId;
  }
  if (!input.sessionId) return null;

  if (cache?.has(input.sessionId)) {
    return cache.get(input.sessionId) ?? null;
  }

  const item = await tx.depositItem.findFirst({
    where: { sessionId: input.sessionId, status: { in: ["PENDING", "REVIEW"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const id = item?.id ?? null;
  cache?.set(input.sessionId, id);
  return id;
}
