import { MachineEventType } from "@prisma/client";
import { ZodError, z } from "zod";
import { InvalidSessionTransitionError } from "../machine-state";
import { HttpError } from "../rbac";

/**
 * POST /api/machine-events protocol v2 (contract fixture:
 * tests/fixtures/contracts/machine-events.v2.json, worker: rvm/sync.py).
 *
 * A valid batch always answers HTTP 200 with one result per event. The worker
 * removes an event from its outbox only on `accepted`/`duplicate`; an error
 * with `retryable: false` is dead-lettered on the machine, any other error is
 * retried with the same localEventId. `accepted` is reported only after the
 * event and its side effects (reward included) committed. v2 is additive over
 * v1: `protocolVersion` and `retryable` are new, `received`/`results` keep
 * their meaning.
 */
export const MACHINE_EVENTS_PROTOCOL_VERSION = 2 as const;

/** Stable, non-sensitive codes; never a message, stack or SQL detail. */
export type MachineEventErrorCode =
  /** The event itself is malformed (unknown type, bad field). Permanent. */
  | "INVALID_EVENT"
  /** Well-formed but deterministically refused by the data/rules. Permanent. */
  | "EVENT_REJECTED"
  /** Database availability, contention or an unclassified failure. Retry. */
  | "TEMPORARY_FAILURE";

export type MachineEventResult =
  | { localEventId: string; status: "accepted" | "duplicate"; eventId: string }
  | { localEventId: string; status: "error"; error: MachineEventErrorCode; retryable: boolean };

export interface MachineEventsResponse {
  protocolVersion: typeof MACHINE_EVENTS_PROTOCOL_VERSION;
  received: number;
  results: MachineEventResult[];
}

const parsableDate = (value: string) => !Number.isNaN(Date.parse(value));

/** Per-event schema: a failure rejects only that event (INVALID_EVENT). */
export const machineEventSchema = z.object({
  localEventId: z.string().min(1),
  eventType: z.nativeEnum(MachineEventType),
  payload: z.record(z.unknown()).optional().nullable(),
  sessionId: z.string().optional().nullable(),
  depositItemId: z.string().optional().nullable(),
  occurredAt: z.string().refine(parsableDate).optional().nullable(),
});

export type ParsedMachineEvent = z.infer<typeof machineEventSchema>;

export function eventFailure(
  localEventId: string,
  failure: { error: MachineEventErrorCode; retryable: boolean },
): MachineEventResult {
  return { localEventId, status: "error", error: failure.error, retryable: failure.retryable };
}

export const INVALID_EVENT = { error: "INVALID_EVENT", retryable: false } as const;
const EVENT_REJECTED = { error: "EVENT_REJECTED", retryable: false } as const;
const TEMPORARY_FAILURE = { error: "TEMPORARY_FAILURE", retryable: true } as const;

/** Prisma request errors a retry can outlive. Any other P2xxx is permanent. */
const TRANSIENT_PRISMA_CODES = new Set([
  "P2002", // unique collision whose winner is not visible yet (ingest re-reads first)
  "P2024", // connection pool timeout
  "P2028", // interactive transaction expired/closed
  "P2034", // write conflict or deadlock
  "P2037", // too many database connections
]);

/** SQLSTATE of a failed raw query (P2010): connection (08), rollback incl.
 * serialization/deadlock (40), resources (53), operator/statement timeout
 * (57), system (58) and lock_not_available (55P03) are transient. */
const TRANSIENT_SQLSTATE = /^(?:08|40|53|57|58)|^55P03$/;

/**
 * Splits ingest failures into permanent rejections (dead-lettered on the
 * machine) and transient ones (retried with the same localEventId). Unknown
 * failures are transient: the event stays on the machine instead of being
 * lost, and per-event backoff keeps it from blocking the rest of the queue.
 */
export function classifyIngestFailure(error: unknown): { error: MachineEventErrorCode; retryable: boolean } {
  if (error instanceof InvalidSessionTransitionError) return EVENT_REJECTED;
  if (error instanceof ZodError) return INVALID_EVENT;
  if (error instanceof HttpError) return error.status >= 500 ? TEMPORARY_FAILURE : EVENT_REJECTED;

  const { name, code, meta } = (error ?? {}) as { name?: unknown; code?: unknown; meta?: { code?: unknown } };
  if (name === "PrismaClientValidationError") return EVENT_REJECTED;
  if (name === "PrismaClientInitializationError" || name === "PrismaClientRustPanicError") {
    return TEMPORARY_FAILURE;
  }
  if (typeof code === "string") {
    if (code.startsWith("P1") || TRANSIENT_PRISMA_CODES.has(code)) return TEMPORARY_FAILURE;
    if (code === "P2010") {
      return typeof meta?.code === "string" && TRANSIENT_SQLSTATE.test(meta.code)
        ? TEMPORARY_FAILURE
        : EVENT_REJECTED;
    }
    if (/^P2\d{3}$/.test(code)) return EVENT_REJECTED;
  }
  return TEMPORARY_FAILURE;
}

/** Log tag without message text (which may carry hosts or SQL). */
export function failureTag(error: unknown): string {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  return [typeof name === "string" ? name : "UnknownError", typeof code === "string" ? code : null]
    .filter(Boolean)
    .join(":");
}
