CREATE TYPE "RemoteCommandStatus" AS ENUM (
  'QUEUED',
  'DISPATCHED',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "RemoteCommandType" AS ENUM (
  'REFRESH_STATE',
  'CAPTURE_SNAPSHOT',
  'SYNC_NOW',
  'STOP_ALL',
  'OPEN_GATE',
  'CLOSE_GATE',
  'RESET_ALERT',
  'ENTER_MAINTENANCE',
  'RESUME_OPERATION'
);

CREATE TABLE "MachineRemoteCommand" (
  "id" TEXT NOT NULL,
  "machineId" TEXT NOT NULL,
  "requestedById" TEXT,
  "command" "RemoteCommandType" NOT NULL,
  "status" "RemoteCommandStatus" NOT NULL DEFAULT 'QUEUED',
  "payloadJson" JSONB,
  "resultJson" JSONB,
  "errorMessage" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "dispatchedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MachineRemoteCommand_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MachineRemoteCommand_machineId_status_createdAt_idx"
ON "MachineRemoteCommand"("machineId", "status", "createdAt");

CREATE INDEX "MachineRemoteCommand_requestedById_createdAt_idx"
ON "MachineRemoteCommand"("requestedById", "createdAt");

ALTER TABLE "MachineRemoteCommand"
ADD CONSTRAINT "MachineRemoteCommand_machineId_fkey"
FOREIGN KEY ("machineId") REFERENCES "Machine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
