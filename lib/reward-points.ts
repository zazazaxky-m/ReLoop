import { formatNumber } from "./format";

export function toRewardPoints(amount: number, pointsToRupiah: number): number {
  if (pointsToRupiah <= 0) return 0;
  return Math.floor(amount / pointsToRupiah);
}

export function formatRewardPoints(amount: number, pointsToRupiah: number): string {
  return `${formatNumber(toRewardPoints(amount, pointsToRupiah))} poin`;
}
