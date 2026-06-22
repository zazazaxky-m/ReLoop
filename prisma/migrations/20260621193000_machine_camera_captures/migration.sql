CREATE TABLE "MachineCapture" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "sessionId" TEXT,
    "localCaptureId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scenePath" TEXT NOT NULL,
    "facePathsJson" JSONB NOT NULL,
    "metadataJson" JSONB,
    "faceCount" INTEGER NOT NULL DEFAULT 0,
    "personDetected" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MachineCapture_machineId_localCaptureId_key"
ON "MachineCapture"("machineId", "localCaptureId");

CREATE INDEX "MachineCapture_machineId_occurredAt_idx"
ON "MachineCapture"("machineId", "occurredAt");

CREATE INDEX "MachineCapture_sessionId_idx"
ON "MachineCapture"("sessionId");

CREATE INDEX "MachineCapture_kind_occurredAt_idx"
ON "MachineCapture"("kind", "occurredAt");

ALTER TABLE "MachineCapture"
ADD CONSTRAINT "MachineCapture_machineId_fkey"
FOREIGN KEY ("machineId") REFERENCES "Machine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MachineCapture"
ADD CONSTRAINT "MachineCapture_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "DepositSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
