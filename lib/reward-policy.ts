/**
 * Reward policy (task M04, findings LOG-04 and LOG-05): the single, pure
 * decision of whether a deposit earns money, how much, and in which ledger
 * status. Every money path calls it: machine acceptance
 * (lib/machine-events/acceptance.ts), deposit review (lib/deposit-review.ts)
 * and trip check-out / bag scan (lib/trip-validation.ts). Writing the decided
 * amount is lib/reward-credit.ts's job.
 *
 * No database, network or clock access here: inputs in, decision out.
 */

export type RewardMode = "MONEY_REWARD" | "COMPLIANCE_ONLY";
export type RewardStatus = "ACCEPTED" | "REVIEW" | "REJECTED";
export type RewardLedgerStatus = "AVAILABLE" | "PENDING";

export interface RewardDecisionInput {
  mode: RewardMode;
  /** Integer rupiah the deposit is worth under the applicable rate (0 when there is none). */
  baseAmount: number;
  weightValid: boolean;
  /** The material matches the selected waste type (see verifyMaterial). */
  typeMatch: boolean;
  /** Sensor-sequence anomaly, fraud flag or a session already under review. */
  hasAnomaly: boolean;
}

export interface RewardDecision {
  status: RewardStatus;
  /** Integer rupiah to credit; always 0 for COMPLIANCE_ONLY and REJECTED. */
  amount: number;
  ledgerStatus: RewardLedgerStatus;
  reason: string;
}

/**
 * Share of the base amount held as EARN/PENDING while a deposit waits for
 * review. The reviewer's decision then pays the full target (or nothing) as a
 * correction keyed `review:<itemId>:decision:v1` (lib/deposit-review.ts).
 */
export const REVIEW_HOLD_RATIO = 0.5;

/** Largest rupiah value a ledger row can hold (PostgreSQL `integer`). */
const MAX_RUPIAH = 2_147_483_647;

/**
 * Precedence: an invalid weight rejects; an anomaly or a material mismatch
 * holds for review (PENDING); otherwise the deposit is accepted (AVAILABLE).
 * COMPLIANCE_ONLY keeps the same status but never carries money.
 */
export function decideReward(input: RewardDecisionInput): RewardDecision {
  const { baseAmount } = input;
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0 || baseAmount > MAX_RUPIAH) {
    throw new RangeError(`baseAmount must be a non-negative integer rupiah value, got ${baseAmount}`);
  }
  if (input.mode !== "MONEY_REWARD" && input.mode !== "COMPLIANCE_ONLY") {
    throw new RangeError(`unknown reward mode ${String(input.mode)}`);
  }
  if (!input.weightValid) {
    return { status: "REJECTED", amount: 0, ledgerStatus: "PENDING", reason: "WEIGHT_INVALID" };
  }
  const review = input.hasAnomaly || !input.typeMatch;
  const status: RewardStatus = review ? "REVIEW" : "ACCEPTED";
  const ledgerStatus: RewardLedgerStatus = review ? "PENDING" : "AVAILABLE";
  const reason = input.hasAnomaly ? "ANOMALY_REVIEW" : !input.typeMatch ? "TYPE_MISMATCH" : "ACCEPTED";
  if (input.mode === "COMPLIANCE_ONLY") return { status, amount: 0, ledgerStatus, reason };
  const amount = review ? Math.floor(baseAmount * REVIEW_HOLD_RATIO) : baseAmount;
  return { status, amount, ledgerStatus, reason };
}

// ---------------------------------------------------------------------------
// Material verification (AI taxonomy, barcode, weight)
// ---------------------------------------------------------------------------

/**
 * How a machine verifies that the inserted material is the selected waste
 * type (Machine.materialVerification, admin-configurable per machine):
 *
 * - AI_REQUIRED: the classifier must report a confident label that the waste
 *   type accepts; missing or unavailable classification holds for review.
 * - BARCODE_WEIGHT: a machine without AI dependency; a barcode must be read
 *   (the weight window is checked for every policy).
 * - WEIGHT_ONLY: the weight window alone (the pre-M04 behaviour and default).
 *
 * Under every policy a label the classifier did report is checked against the
 * waste type's taxonomy: a reported mismatch or low confidence always holds
 * the item for review, it is never ignored.
 */
export type MaterialVerificationPolicy = "AI_REQUIRED" | "BARCODE_WEIGHT" | "WEIGHT_ONLY";

export type MaterialReason =
  | "AI_MATCH"
  | "AI_TYPE_MISMATCH"
  | "AI_LOW_CONFIDENCE"
  | "AI_UNAVAILABLE"
  | "AI_TAXONOMY_MISSING"
  | "BARCODE_WEIGHT"
  | "BARCODE_MISSING"
  | "WEIGHT_ONLY";

/** Minimum classifier confidence for a label to count as a match (pre-M04 hint threshold). */
export const AI_MIN_CONFIDENCE = 0.5;

/** Canonical form of a classifier label / taxonomy entry: `Bottle PET` -> `bottle_pet`. */
export function normalizeAiLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Normalized, de-duplicated taxonomy for WasteType.aiAcceptedLabels (admin input). */
export function normalizeAiLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.map(normalizeAiLabel).filter(Boolean))];
}

/** A normalized label: lowercase letters, digits, `_` and `.` (e.g. `bottle_pet`). */
export const AI_LABEL_PATTERN = /^[a-z0-9_.]{1,64}$/;

export interface MaterialInput {
  policy: MaterialVerificationPolicy;
  /** WasteType.aiAcceptedLabels of the selected waste type. */
  acceptedLabels: readonly string[];
  aiLabel?: string | null;
  aiConfidence?: number | null;
  barcodeValue?: string | null;
  minConfidence?: number;
}

/**
 * The edge reports an unavailable classifier as label `unknown` with
 * confidence 0 (camera disabled, no frame, no model; rvm/camera.py), or not at
 * all. A label with confidence > 0 is a real classification, including a
 * confident `unknown`.
 */
function classifierReported(input: MaterialInput): boolean {
  return (
    typeof input.aiLabel === "string" &&
    input.aiLabel.trim() !== "" &&
    typeof input.aiConfidence === "number" &&
    Number.isFinite(input.aiConfidence) &&
    input.aiConfidence > 0
  );
}

const MATERIAL_POLICIES: readonly MaterialVerificationPolicy[] = ["AI_REQUIRED", "BARCODE_WEIGHT", "WEIGHT_ONLY"];

export function verifyMaterial(raw: MaterialInput): { typeMatch: boolean; reason: MaterialReason } {
  // Fail closed: an unknown or missing policy is treated as the strictest one.
  const input: MaterialInput = MATERIAL_POLICIES.includes(raw.policy) ? raw : { ...raw, policy: "AI_REQUIRED" };
  const accepted = new Set(input.acceptedLabels.map(normalizeAiLabel).filter(Boolean));
  let aiConfirmed = false;
  if (classifierReported(input)) {
    if (accepted.size > 0) {
      // A reported label is never ignored: it can always hold the item.
      if ((input.aiConfidence as number) < (input.minConfidence ?? AI_MIN_CONFIDENCE)) {
        return { typeMatch: false, reason: "AI_LOW_CONFIDENCE" };
      }
      if (!accepted.has(normalizeAiLabel(input.aiLabel as string))) {
        return { typeMatch: false, reason: "AI_TYPE_MISMATCH" };
      }
      aiConfirmed = true;
    } else if (input.policy === "AI_REQUIRED") {
      // The waste type has no taxonomy: a label can neither confirm nor refute it.
      return { typeMatch: false, reason: "AI_TAXONOMY_MISSING" };
    }
  } else if (input.policy === "AI_REQUIRED") {
    return { typeMatch: false, reason: "AI_UNAVAILABLE" };
  }
  // The machine policy's own requirement always applies as well.
  if (input.policy === "BARCODE_WEIGHT") {
    return input.barcodeValue && input.barcodeValue.trim() !== ""
      ? { typeMatch: true, reason: "BARCODE_WEIGHT" }
      : { typeMatch: false, reason: "BARCODE_MISSING" };
  }
  return aiConfirmed ? { typeMatch: true, reason: "AI_MATCH" } : { typeMatch: true, reason: "WEIGHT_ONLY" };
}

// ---------------------------------------------------------------------------
// Campaign type and mode guards
// ---------------------------------------------------------------------------

export interface CampaignPolicyInput {
  campaignType: string;
  rewardMode: RewardMode | string;
  /** Campaign.supportsMachine: lets an EVENT/SCHOOL_PROGRAM campaign run at machines. */
  supportsMachine: boolean;
}

/**
 * Machine deposits (scan, acceptance, review) may run under MACHINE_DEPOSIT
 * campaigns, and under EVENT / SCHOOL_PROGRAM campaigns whose admin enabled
 * `supportsMachine`. TRASH_BAG and TOURISM_PROGRAM are trip programs and never
 * apply to a machine.
 */
export function campaignSupportsMachine(campaign: Pick<CampaignPolicyInput, "campaignType" | "supportsMachine">): boolean {
  if (campaign.campaignType === "MACHINE_DEPOSIT") return true;
  if (campaign.campaignType === "EVENT" || campaign.campaignType === "SCHOOL_PROGRAM") return campaign.supportsMachine === true;
  return false;
}

function asMode(mode: string): RewardMode {
  return mode === "MONEY_REWARD" ? "MONEY_REWARD" : "COMPLIANCE_ONLY";
}

/**
 * Mode of a machine deposit: the session's campaign when it supports machines
 * (a legacy session bound to another campaign type earns nothing), or the
 * organization's explicit Organization.machineRewardMode when the session has
 * no campaign.
 */
export function machineRewardMode(input: { campaign: CampaignPolicyInput | null; organizationMode: RewardMode | string }): RewardMode {
  if (!input.campaign) return asMode(input.organizationMode);
  if (!campaignSupportsMachine(input.campaign)) return "COMPLIANCE_ONLY";
  return asMode(input.campaign.rewardMode);
}

/** Trip programs (TRASH_BAG, TOURISM_PROGRAM) pay in their campaign's mode; any other type never pays a trip. */
export function tripRewardMode(campaign: Pick<CampaignPolicyInput, "campaignType" | "rewardMode">): RewardMode {
  if (campaign.campaignType !== "TRASH_BAG" && campaign.campaignType !== "TOURISM_PROGRAM") return "COMPLIANCE_ONLY";
  return asMode(campaign.rewardMode);
}
