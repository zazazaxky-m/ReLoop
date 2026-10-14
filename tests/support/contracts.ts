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

/**
 * GET /api/reports/reconciliation v1 (tests/fixtures/contracts/reconciliation-report.v1.json),
 * SUPERADMIN only. Read by the mobile ReconciliationLiability.fromJson
 * (mobile/test/contracts/reconciliation_report_contract_test.dart). Money is
 * integer rupiah; `totalOutstanding` is the compatibility alias of
 * `availableLiability`.
 */
const rupiah = z.number().int();
const nonNegativeRupiah = rupiah.nonnegative();
const redemptionStatus = z.enum(["REQUESTED", "APPROVED", "PROCESSING", "SUCCESS", "FAILED", "REVERSED"]);
const ledgerStatus = z.enum(["PENDING", "AVAILABLE", "REDEEMED", "REVERSED", "REJECTED"]);

const payoutMismatchV1 = z.object({
  redemptionId: z.string().min(1).nullable(),
  userId: z.string().min(1),
  requestStatus: redemptionStatus.nullable(),
  requestAmount: rupiah.nullable(),
  reserveStatuses: z.array(ledgerStatus),
  ledgerIds: z.array(z.string().min(1)),
  paidDifference: rupiah,
  reservedDifference: rupiah,
  problem: z.enum([
    "RESERVE_MISSING", "DUPLICATE_RESERVE", "RESERVE_STATE_MISMATCH", "AMOUNT_MISMATCH",
    "NOT_LINKED_TO_REDEMPTION", "MISSING_REFERENCE", "REQUEST_NOT_FOUND", "OWNER_MISMATCH",
  ]),
});

/** B01a: one reservation that needs an operator (owner and reconciliation reason). */
export const fundingStaleHoldV1 = z.object({
  reservationId: z.string().min(1),
  businessKey: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  campaignId: z.string().min(1).nullable(),
  sourceType: z.enum(["SESSION", "TRIP"]),
  sourceId: z.string().min(1),
  sourceStatus: z.string().min(1).nullable(),
  ceilingRupiah: nonNegativeRupiah,
  remainingRupiah: nonNegativeRupiah,
  shortfallRupiah: nonNegativeRupiah,
  campaignShortfallRupiah: nonNegativeRupiah,
  ageMinutes: z.number().int().nonnegative(),
  reasons: z.array(z.enum([
    "SOURCE_CLOSED_AWAITING_WATERMARK", "SOURCE_OPEN_TOO_LONG", "CEILING_NOT_CONFIGURED", "CAPACITY_SHORTFALL",
  ])).min(1),
  reconciliation: z.string().min(1),
});

/** B01a: reward funding per organization (program-side money, read in the report's snapshot). */
export const fundingVisibilityV1 = z.object({
  enforced: z.boolean(),
  totalConfirmedRupiah: rupiah,
  totalHeldRupiah: rupiah,
  staleHoldCount: z.number().int().nonnegative(),
  organizations: z.array(z.object({
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    accountId: z.string().min(1).nullable(),
    confirmedRupiah: rupiah,
    heldRupiah: rupiah,
    capacityRupiah: rupiah,
    activeReservations: z.number().int().nonnegative(),
    reservedRemainingRupiah: nonNegativeRupiah,
    uncoveredRupiah: nonNegativeRupiah,
    staleHolds: z.array(fundingStaleHoldV1),
  })),
}).superRefine((funding, ctx) => {
  const confirmed = funding.organizations.reduce((sum, org) => sum + org.confirmedRupiah, 0);
  const held = funding.organizations.reduce((sum, org) => sum + org.heldRupiah, 0);
  const stale = funding.organizations.reduce((sum, org) => sum + org.staleHolds.length, 0);
  if (confirmed !== funding.totalConfirmedRupiah || held !== funding.totalHeldRupiah || stale !== funding.staleHoldCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "funding totals must equal the sum over organizations" });
  }
  for (const org of funding.organizations) {
    if (org.capacityRupiah !== org.confirmedRupiah - org.heldRupiah) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `capacityRupiah must be confirmed - held (${org.organizationId})` });
    }
  }
});

export const reconciliationReportV1 = z.object({
  availableLiability: nonNegativeRupiah,
  pendingLiability: nonNegativeRupiah,
  reservedLiability: rupiah,
  paidTotal: rupiah,
  totalObligation: rupiah,
  overdrawn: z.object({ users: z.number().int().nonnegative(), availableShortfall: nonNegativeRupiah, pendingShortfall: nonNegativeRupiah }),
  allocationStatus: z.literal("NOT_ALLOCATED_UNTIL_B01"),
  unallocatedLegacyAmount: rupiah,
  organizations: z.array(z.object({
    organizationId: z.string().min(1).nullable(),
    organizationName: z.string().min(1),
    earnAvailable: rupiah,
    earnPending: rupiah,
    adjustments: rupiah,
    outstanding: rupiah,
    allocationStatus: z.literal("UNALLOCATED_LEGACY"),
  })),
  totalOutstanding: rupiah,
  totalEarnAvailable: rupiah,
  totalEarnPending: rupiah,
  ledgerRedeemed: rupiah,
  ledgerReserved: rupiah,
  redemptionSuccessTotal: rupiah,
  redemptionInFlightTotal: rupiah,
  redeemedDiscrepancy: nonNegativeRupiah,
  reservedDiscrepancy: nonNegativeRupiah,
  hasDiscrepancy: z.boolean(),
  payoutMismatches: z.array(payoutMismatchV1),
  payoutMismatchCount: z.number().int().nonnegative(),
  flaggedTransfers: z.object({ count: z.number().int().nonnegative(), amount: nonNegativeRupiah }),
  rewardCases: z.object({
    open: z.number().int().nonnegative(),
    openAmount: nonNegativeRupiah,
    recent: z.array(z.object({
      id: z.string().min(1),
      businessKey: z.string().min(1),
      userId: z.string().min(1),
      depositItemId: z.string().nullable(),
      amount: rupiah,
      entryType: z.enum(["EARN", "REDEEM", "PENALTY", "REVERSE", "ADJUST"]),
      reasonCode: z.string().min(1),
      createdAt: isoDate,
    })),
  }),
  funding: fundingVisibilityV1,
  snapshot: z.object({ readOnly: z.literal(true), isolation: z.literal("repeatable read") }),
  generatedAt: isoDate,
}).superRefine((report, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (report.totalObligation !== report.availableLiability + report.reservedLiability + report.pendingLiability) {
    issue("totalObligation must be available + reserved + pending");
  }
  if (report.totalOutstanding !== report.availableLiability) issue("totalOutstanding must alias availableLiability");
  if (report.hasDiscrepancy !== (report.redeemedDiscrepancy !== 0 || report.reservedDiscrepancy !== 0)) {
    issue("hasDiscrepancy must follow the discrepancy totals");
  }
  const allocated = report.organizations.reduce((sum, org) => sum + org.outstanding, 0);
  if (allocated + report.unallocatedLegacyAmount !== report.availableLiability) {
    issue("organization allocations + unallocatedLegacyAmount must equal availableLiability");
  }
});

export const reconciliationReportResponseV1 = z.object({ report: reconciliationReportV1 });

export const reconciliationReportContractV1 = z.object({
  contract: z.literal("reconciliation-report"),
  version: z.literal(1),
  endpoint: z.literal("GET /api/reports/reconciliation"),
  status: z.literal(200),
  description: z.string().min(1),
  response: reconciliationReportResponseV1,
}).strict();
