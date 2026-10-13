-- A02 fix round 1 (SEC-04 follow-up): single-use TOTP codes (RFC 6238 §5.2).
--
-- Expand only: one nullable column, User.totpLastUsedStep, the time step
-- (unix seconds / 30) of the last code accepted for the active factor. Login,
-- setup and disable proofs refuse a code whose step is at or before it and
-- record the new step in the same write; promoting a new factor sets it to the
-- step of that factor's confirm code; disable and erasure clear it.
--
-- No backfill: NULL means no code has been accepted yet, so every existing
-- factor keeps working and its next code is accepted once. No enforce step:
-- any integer or NULL is valid. Code before this change never reads or writes
-- the column, so old and new code can run side by side during the rollout.
-- Additive; no DROP of the hand-written partial unique indexes or of the
-- User_pendingTotp_all_or_none CHECK.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpLastUsedStep" INTEGER;
