import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { computeRewardAmount, computeWeightBasedRewardAmount, resolveRewardRate } from "./reward";
import { campaignSupportsMachine, machineRewardMode, type RewardMode } from "./reward-policy";

/**
 * Admission snapshot of a deposit session (B01b, BIZ-02).
 *
 * At admission (lib/deposit-session-service.ts) the server records, per
 * machine waste type, the rate the session will be priced at, plus the
 * campaign multiplier, the effective reward mode and the session bounds. Every
 * acceptance point of the session, including late or offline batches that
 * arrive after the operator changed a rate or multiplier, is priced from this
 * snapshot (lib/machine-events/acceptance.ts, lib/deposit-review.ts): material
 * that was admitted under one price is never repriced by a later configuration.
 *
 * `policyVersion` is the SHA-256 of the snapshot's canonical form and is bound
 * into the signed lease v2 (lib/machine-lease.ts); the RVM receives the machine
 * view (`machinePolicyView`), recomputes the hash and refuses a lease whose
 * snapshot does not match, so the per-item caps it enforces locally are
 * tamper-evident. The canonical form carries integers and strings only (the
 * multiplier in basis points), so Node and Python serialize it byte-identically.
 */

export const SESSION_POLICY_VERSION = 1 as const;

export interface SessionPolicyWasteType {
  id: string;
  unit: "ITEM" | "KG";
  /** Rupiah per item (ITEM) or per kilogram (KG) at admission. */
  rewardPerUnit: number;
  /** The most one item of this type can pay (null: unbounded weight, the RVM applies its own max weight). */
  maxRewardRupiah: number | null;
  rewardRateId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

export interface SessionPolicySnapshot {
  version: typeof SESSION_POLICY_VERSION;
  mode: RewardMode;
  /** Campaign multiplier x 10 000, rounded (1 = 10000). */
  multiplierBps: number;
  /** Configured per-session reward ceiling (null: no money bound, e.g. COMPLIANCE_ONLY or not configured in shadow mode). */
  ceilingRupiah: number | null;
  /** Configured per-session item bound (null: none). */
  maxItems: number | null;
  capturedAt: string;
  wasteTypes: SessionPolicyWasteType[];
}

/** What the RVM receives inside the lease: exactly the fields the version hashes. */
export interface MachinePolicyView {
  version: typeof SESSION_POLICY_VERSION;
  mode: RewardMode;
  multiplierBps: number;
  wasteTypes: Pick<SessionPolicyWasteType, "id" | "unit" | "rewardPerUnit" | "maxRewardRupiah">[];
}

export interface SessionLimits {
  maxRewardRupiah: number | null;
  maxItems: number | null;
}

const BPS = 10_000;

export function multiplierToBps(multiplier: number | null | undefined): number {
  const value = multiplier != null && multiplier > 0 ? multiplier : 1;
  return Math.round(value * BPS);
}

export function bpsToMultiplier(multiplierBps: number): number {
  return multiplierBps / BPS;
}

/**
 * The most the server could pay for one item of a type under the snapshot:
 * ITEM = round(rate x multiplier) for one item; KG = the rate at the type's
 * maximum weight; a KG type without a maximum weight is unbounded here (null)
 * and the RVM bounds it with its own `max_item_weight_grams`.
 */
export function policyItemCap(
  type: Pick<SessionPolicyWasteType, "unit" | "rewardPerUnit" | "maxWeightGrams">,
  multiplierBps: number,
): number | null {
  const multiplier = bpsToMultiplier(multiplierBps);
  if (type.unit === "KG") {
    if (type.maxWeightGrams == null) return null;
    return computeWeightBasedRewardAmount(type.rewardPerUnit, type.maxWeightGrams, multiplier);
  }
  return computeRewardAmount(type.rewardPerUnit, 1, multiplier);
}

/** Canonical form (compact JSON, waste types sorted by id): what `policyVersion` hashes. */
export function canonicalSessionPolicy(policy: MachinePolicyView | SessionPolicySnapshot): string {
  const rows = [...policy.wasteTypes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((type) => [type.id, type.unit, type.rewardPerUnit, type.maxRewardRupiah]);
  return JSON.stringify([SESSION_POLICY_VERSION, policy.mode, policy.multiplierBps, rows]);
}

export function sessionPolicyVersion(policy: MachinePolicyView | SessionPolicySnapshot): string {
  return createHash("sha256").update(canonicalSessionPolicy(policy), "utf8").digest("hex");
}

export function machinePolicyView(policy: SessionPolicySnapshot): MachinePolicyView {
  return {
    version: SESSION_POLICY_VERSION,
    mode: policy.mode,
    multiplierBps: policy.multiplierBps,
    wasteTypes: policy.wasteTypes.map((type) => ({
      id: type.id, unit: type.unit, rewardPerUnit: type.rewardPerUnit, maxRewardRupiah: type.maxRewardRupiah,
    })),
  };
}

/** The limit the user sees before the first item (scan/session responses). */
export function sessionLimits(policy: SessionPolicySnapshot | null | undefined): SessionLimits {
  if (!policy) return { maxRewardRupiah: null, maxItems: null };
  return { maxRewardRupiah: policy.mode === "MONEY_REWARD" ? policy.ceilingRupiah : null, maxItems: policy.maxItems };
}

const nonNegativeInt = z.number().int().nonnegative();
const snapshotSchema = z.object({
  version: z.literal(SESSION_POLICY_VERSION),
  mode: z.enum(["MONEY_REWARD", "COMPLIANCE_ONLY"]),
  multiplierBps: z.number().int().positive(),
  ceilingRupiah: nonNegativeInt.nullable(),
  maxItems: z.number().int().positive().nullable(),
  capturedAt: z.string().min(1),
  wasteTypes: z.array(z.object({
    id: z.string().min(1),
    unit: z.enum(["ITEM", "KG"]),
    rewardPerUnit: nonNegativeInt,
    maxRewardRupiah: nonNegativeInt.nullable(),
    rewardRateId: z.string().min(1).nullable(),
    minWeightGrams: nonNegativeInt.nullable(),
    maxWeightGrams: nonNegativeInt.nullable(),
  })),
});

/** The stored column parsed strictly; anything else (legacy null, corruption) is null, never a crash. */
export function parseSessionPolicy(json: unknown): SessionPolicySnapshot | null {
  const parsed = snapshotSchema.safeParse(json);
  return parsed.success ? (parsed.data as SessionPolicySnapshot) : null;
}

export interface BuildSessionPolicyInput {
  machine: {
    id: string;
    organizationId: string;
    maxItemsPerSession: number | null;
    organization: { machineRewardMode: string };
    wasteTypes: { wasteType: {
      id: string; unit?: string | null; defaultRewardPerItem?: number | null; minWeightGrams?: number | null; maxWeightGrams?: number | null;
    } }[];
  };
  campaign: { id: string; campaignType: string; rewardMode: string; supportsMachine: boolean; rewardMultiplier: number | null } | null;
  /** Configured per-session ceiling (lib/reward-funding.ts resolveSessionCeiling), null when none is configured. */
  ceilingRupiah: number | null;
  now?: Date;
}

/**
 * Builds the snapshot inside the admission transaction (after the locks):
 * for every active waste type of the machine the rate a new acceptance would
 * use right now (campaign > organization > global, lib/reward.ts) or the
 * type's own default. A snapshot is the price list of this session only.
 */
export async function buildSessionPolicy(
  tx: Prisma.TransactionClient,
  input: BuildSessionPolicyInput,
): Promise<SessionPolicySnapshot> {
  const now = input.now ?? new Date();
  const campaign = input.campaign;
  const machineCampaign = campaign && campaignSupportsMachine(campaign) ? campaign : null;
  const mode = machineRewardMode({ campaign, organizationMode: input.machine.organization.machineRewardMode });
  const multiplierBps = multiplierToBps(machineCampaign?.rewardMultiplier);
  const wasteTypes: SessionPolicyWasteType[] = [];
  for (const link of input.machine.wasteTypes) {
    const type = link.wasteType;
    const rate = await resolveRewardRate(
      { organizationId: input.machine.organizationId, campaignId: machineCampaign?.id ?? null, wasteTypeId: type.id, now },
      tx,
    );
    const unit: "ITEM" | "KG" = (rate?.unit ?? type.unit) === "KG" ? "KG" : "ITEM";
    const rewardPerUnit = mode === "MONEY_REWARD" ? Math.max(0, rate?.pointsPerItem ?? type.defaultRewardPerItem ?? 0) : 0;
    const entry: SessionPolicyWasteType = {
      id: type.id,
      unit,
      rewardPerUnit,
      maxRewardRupiah: null,
      rewardRateId: rate?.id ?? null,
      minWeightGrams: rate?.minWeightGrams ?? type.minWeightGrams ?? null,
      maxWeightGrams: rate?.maxWeightGrams ?? type.maxWeightGrams ?? null,
    };
    entry.maxRewardRupiah = policyItemCap(entry, multiplierBps);
    wasteTypes.push(entry);
  }
  wasteTypes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const maxItems = input.machine.maxItemsPerSession != null && input.machine.maxItemsPerSession > 0 ? input.machine.maxItemsPerSession : null;
  return {
    version: SESSION_POLICY_VERSION,
    mode,
    multiplierBps,
    ceilingRupiah: mode === "MONEY_REWARD" ? input.ceilingRupiah : null,
    maxItems,
    capturedAt: now.toISOString(),
    wasteTypes,
  };
}

/** Prisma data for the two session columns. */
export function sessionPolicyColumns(policy: SessionPolicySnapshot): { policyVersion: string; policySnapshotJson: Prisma.InputJsonValue } {
  return { policyVersion: sessionPolicyVersion(policy), policySnapshotJson: policy as unknown as Prisma.InputJsonValue };
}
