import { z } from "zod";

/**
 * Backend side of the versioned cross-client DTO fixtures in
 * tests/fixtures/contracts/. The mobile side parses the same files with its
 * real fromJson models (mobile/test/contracts/). Additive fields are allowed;
 * removing/renaming/retyping a field requires a new versioned fixture.
 */
const isoDate = z.string().datetime({ offset: true });
const sessionStatus = z.enum(["RESERVED", "ACTIVE", "PROCESSING_ITEM", "COMPLETED", "REVIEW", "CANCELLED", "EXPIRED"]);

export const scanSessionResponseV1 = z.object({
  session: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
    machineId: z.string().min(1),
    campaignId: z.string().nullable(),
    status: sessionStatus,
    startedAt: isoDate,
    completedAt: isoDate.nullable(),
    timeoutAt: isoDate.nullable(),
    anomalyCount: z.number().int().nonnegative(),
    createdAt: isoDate,
    updatedAt: isoDate,
  }),
  machine: z.object({
    id: z.string().min(1),
    machineCode: z.string().min(1),
    name: z.string().min(1),
    organizationName: z.string().min(1),
    supportedWasteTypes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1),
  }),
  resumed: z.boolean(),
});

export const scanSessionContractV1 = z.object({
  contract: z.literal("scan-session"),
  version: z.literal(1),
  endpoint: z.literal("POST /api/scan"),
  status: z.literal(201),
  description: z.string().min(1),
  response: scanSessionResponseV1,
}).strict();

/**
 * POST /api/machine-events protocol v2 (tests/fixtures/contracts/machine-events.v2.json).
 * The RVM worker (tests/test_rvm_sync_contract.py) loads the same file: only
 * accepted/duplicate results ACK an outbox row; error + retryable:false
 * dead-letters it; anything else keeps it pending.
 */
const machineEventRequestItemV2 = z.object({
  localEventId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.unknown()).nullable(),
  sessionId: z.string().nullable(),
  depositItemId: z.string().nullable(),
  occurredAt: z.string().min(1),
}).strict();

const machineEventAckV2 = z.object({
  localEventId: z.string().min(1),
  status: z.enum(["accepted", "duplicate"]),
  eventId: z.string().min(1),
}).strict();

const machineEventErrorV2 = z.object({
  localEventId: z.string().min(1),
  status: z.literal("error"),
  error: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retryable: z.boolean().optional(),
}).strict();

export const machineEventsResponseV2 = z.object({
  protocolVersion: z.literal(2),
  received: z.number().int().nonnegative(),
  results: z.array(z.union([machineEventAckV2, machineEventErrorV2])),
}).strict().refine((body) => body.received === body.results.length, {
  message: "received must count the results",
});

const workerOutcomeV2 = z.object({
  acked: z.array(z.string().min(1)),
  pending: z.array(z.string().min(1)),
  deadLetter: z.array(z.string().min(1)),
}).strict();

export const machineEventsContractV2 = z.object({
  contract: z.literal("machine-events"),
  version: z.literal(2),
  endpoint: z.literal("POST /api/machine-events"),
  status: z.literal(200),
  description: z.string().min(1),
  request: z.object({
    machineCode: z.string().min(1),
    events: z.array(machineEventRequestItemV2).min(1),
  }).strict(),
  response: machineEventsResponseV2,
  workerOutcome: workerOutcomeV2,
  compatibility: z.object({
    errorWithoutRetryable: z.object({
      description: z.string().min(1),
      response: machineEventsResponseV2,
      workerOutcome: workerOutcomeV2,
    }).strict(),
    legacyV1: z.object({
      description: z.string().min(1),
      response: z.record(z.unknown()),
      workerOutcome: workerOutcomeV2,
    }).strict(),
  }).strict(),
}).strict();
