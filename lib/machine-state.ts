import type { SessionStatus } from "@prisma/client";

/** Runtime machine/session states used by event ingestion. */
export type MachineRuntimeState =
  | "IDLE"
  | "RESERVED"
  | "ACTIVE"
  | "CHAMBER_OPEN"
  | "PROCESSING_ITEM"
  | "ACCEPTING"
  | "REJECTING"
  | "REVIEW"
  | "COMPLETED"
  | "SAFE_STATE";

const SESSION_TRANSITIONS: Record<
  SessionStatus,
  Partial<Record<string, SessionStatus>>
> = {
  RESERVED: { ACTIVATE: "ACTIVE", CANCEL: "CANCELLED", EXPIRE: "EXPIRED" },
  ACTIVE: {
    START_ITEM: "PROCESSING_ITEM",
    FINISH: "COMPLETED",
    ANOMALY: "REVIEW",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED",
    SAFE_STATE: "REVIEW",
  },
  PROCESSING_ITEM: {
    ITEM_DONE: "ACTIVE",
    FINISH: "COMPLETED",
    ANOMALY: "REVIEW",
    SAFE_STATE: "REVIEW",
    EXPIRE: "EXPIRED",
  },
  REVIEW: { FINISH: "COMPLETED", RESUME: "ACTIVE" },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};

export function canTransitionSession(
  from: SessionStatus,
  action: string,
): SessionStatus | null {
  return SESSION_TRANSITIONS[from]?.[action] ?? null;
}

export function transitionSession(
  current: SessionStatus,
  action: string,
): SessionStatus {
  const next = canTransitionSession(current, action);
  if (!next) {
    throw new Error(`Transisi sesi tidak valid: ${current} + ${action}`);
  }
  return next;
}

/** Machine statuses that reject new deposit sessions. */
export const BLOCKING_MACHINE_STATUSES = new Set([
  "OFFLINE",
  "FULL",
  "MAINTENANCE",
  "ERROR",
]);

export function machineAcceptsSessions(status: string): boolean {
  return !BLOCKING_MACHINE_STATUSES.has(status);
}

/** Expected sensor sequence before acceptance (forward-only). */
export const EXPECTED_SENSOR_STEPS = [
  "CHAMBER_OPEN",
  "ITEM_PRESENT",
  "WEIGHT_STABLE",
  "IMAGE_CAPTURED",
  "CONVEYOR_FORWARD",
  "ACCEPTANCE_POINT",
] as const;

export type SensorStep = (typeof EXPECTED_SENSOR_STEPS)[number];

export interface SensorSequencePayload {
  steps?: string[];
  reverseMotion?: boolean;
  retrievalAttempt?: boolean;
  impossibleSequence?: boolean;
}

/** Returns anomaly reason codes when the sensor path is suspicious. */
export function validateSensorSequence(
  payload: SensorSequencePayload | null | undefined,
): string | null {
  if (!payload) return null;
  if (payload.reverseMotion) return "REVERSE_MOTION";
  if (payload.retrievalAttempt) return "RETRIEVAL_ATTEMPT";
  if (payload.impossibleSequence) return "IMPOSSIBLE_SEQUENCE";

  const steps = payload.steps ?? [];
  if (steps.length === 0) return null;

  let lastIdx = -1;
  for (const step of steps) {
    const idx = EXPECTED_SENSOR_STEPS.indexOf(step as SensorStep);
    if (idx === -1) continue;
    if (idx < lastIdx) return "IMPOSSIBLE_SEQUENCE";
    lastIdx = idx;
  }
  return null;
}
