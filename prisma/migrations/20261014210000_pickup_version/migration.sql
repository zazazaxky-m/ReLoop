-- B05 (BIZ-04): pickup is admin dispatch with a compare-and-set version.
--
-- Expand only: one defaulted column (version 0 for every existing row), five
-- nullable columns, two notification types, a unique index on the new nullable
-- replacement link and a lookup index for the overdue escalation. Nothing here
-- rewrites existing rows: legacy assignments keep assignedAt/expectedStartAt
-- NULL ("unknown", never escalated) instead of a guessed timestamp.
-- The enforce step is in the application, in this same release: PATCH
-- /api/pickups/[id] requires `expectedVersion` for assign/cancel/fail and
-- compares it for every action (docs/mobile-api.md "Pickup dispatch (B05)").
-- Generated with `prisma migrate diff --from-schema-datamodel <d246c78 schema>
-- --to-schema-datamodel prisma/schema.prisma --script`; it contains no DROP
-- INDEX for the hand-written partial unique indexes.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PICKUP_STATUS';
ALTER TYPE "NotificationType" ADD VALUE 'PICKUP_OVERDUE';

-- AlterTable
ALTER TABLE "PickupRequest" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "expectedStartAt" TIMESTAMP(3),
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "replacesPickupId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "PickupRequest_replacesPickupId_key" ON "PickupRequest"("replacesPickupId");

-- CreateIndex
CREATE INDEX "PickupRequest_status_expectedStartAt_idx" ON "PickupRequest"("status", "expectedStartAt");

-- AddForeignKey
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_replacesPickupId_fkey" FOREIGN KEY ("replacesPickupId") REFERENCES "PickupRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
