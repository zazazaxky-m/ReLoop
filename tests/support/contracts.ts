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
