-- B01a fix round 1 (I2): a source admitted without a reservation after the
-- funding cutover (its program turned to money later) gets a zero-ceiling
-- reservation at its first earning, marked here so monitoring can tell it
-- from a configured admission. Expand only (defaulted column); no row changes.

-- AlterTable
ALTER TABLE "RewardBudgetReservation" ADD COLUMN     "lateReservation" BOOLEAN NOT NULL DEFAULT false;

