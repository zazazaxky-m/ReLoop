import { randomBytes } from "node:crypto";

/** Default reward per returned & sorted trash bag (Rp). Business TODO: finalize. */
export const TRASH_BAG_REWARD_PER_BAG = 2000;

/** Generates a unique, human-shareable trash-bag QR code. */
export function generateBagQrCode(): string {
  const rand = randomBytes(6).toString("hex").toUpperCase();
  return `BAG-${rand}`;
}

/** Condition statuses that still earn a reward (sorted/returned in usable shape). */
export function isRewardableCondition(condition: string | null | undefined): boolean {
  return condition === "GOOD" || condition === "PARTIAL";
}
