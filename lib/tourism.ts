export type TourismCondition = "GOOD" | "PARTIAL" | "POOR" | "NOT_RETURNED" | null | undefined;
export type TourismStage = "CHECK_IN" | "CHECK_OUT" | "BANK_SAMPAH_PICKUP";
export type TourismCompliance = "NOT_STARTED" | "CHECKED_IN" | "COMPLIANT" | "NEEDS_REVIEW" | "NON_COMPLIANT";

export interface ComplianceInput {
  stage: TourismStage;
  appCompleted?: boolean;
  assignedBagCount?: number;
  returnedBagCount?: number | null;
  conditionStatus?: TourismCondition;
}

export interface ComplianceResult {
  score: number;
  status: TourismCompliance;
}

export function normalizeTravelAgentEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function calculateCompliance(input: ComplianceInput): ComplianceResult {
  if (input.stage === "CHECK_IN") {
    return {
      score: input.appCompleted ? 30 : 0,
      status: "CHECKED_IN",
    };
  }

  if (input.stage === "BANK_SAMPAH_PICKUP") {
    return { score: 100, status: "COMPLIANT" };
  }

  const assigned = Math.max(0, input.assignedBagCount ?? 0);
  const returned = Math.max(0, input.returnedBagCount ?? 0);
  const appScore = input.appCompleted ? 30 : 0;
  const returnScore = assigned === 0 ? (returned > 0 ? 40 : 0) : returned >= assigned ? 40 : returned > 0 ? 20 : 0;
  const sortedScore =
    input.conditionStatus === "GOOD"
      ? 30
      : input.conditionStatus === "PARTIAL"
        ? 20
        : 0;

  const score = appScore + returnScore + sortedScore;
  const status =
    score >= 80
      ? "COMPLIANT"
      : score >= 50
        ? "NEEDS_REVIEW"
        : "NON_COMPLIANT";

  return { score, status };
}
