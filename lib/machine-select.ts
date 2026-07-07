import type { Prisma } from "@prisma/client";

/** Machine fields safe for API responses — never includes ingestSecret. */
export const machineSafeSelect = {
  id: true,
  organizationId: true,
  regionId: true,
  machineCode: true,
  qrToken: true,
  qrTokenExpiresAt: true,
  qrRotationSeconds: true,
  name: true,
  description: true,
  status: true,
  fillLevelPercent: true,
  capacityKg: true,
  hasInputChamber: true,
  hasConveyor: true,
  hasCompactor: true,
  hasExternalCamera: true,
  chamberTimeoutSeconds: true,
  sessionIdleTimeoutMinutes: true,
  lastHeartbeatAt: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MachineSelect;
