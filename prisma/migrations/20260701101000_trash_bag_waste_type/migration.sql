ALTER TABLE "TrashBagAssignment" ADD COLUMN "wasteTypeId" TEXT;
CREATE INDEX "TrashBagAssignment_wasteTypeId_idx" ON "TrashBagAssignment"("wasteTypeId");
ALTER TABLE "TrashBagAssignment" ADD CONSTRAINT "TrashBagAssignment_wasteTypeId_fkey" FOREIGN KEY ("wasteTypeId") REFERENCES "WasteType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
