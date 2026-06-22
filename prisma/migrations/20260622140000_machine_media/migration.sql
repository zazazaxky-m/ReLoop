CREATE TYPE "MachineMediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TABLE "MachineMedia" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "title" TEXT,
  "mediaType" "MachineMediaType" NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "durationSeconds" INTEGER NOT NULL DEFAULT 8,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MachineMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MachineMedia_machineId_active_sortOrder_idx"
ON "MachineMedia"("machineId", "active", "sortOrder");

ALTER TABLE "MachineMedia"
ADD CONSTRAINT "MachineMedia_machineId_fkey"
FOREIGN KEY ("machineId") REFERENCES "Machine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
