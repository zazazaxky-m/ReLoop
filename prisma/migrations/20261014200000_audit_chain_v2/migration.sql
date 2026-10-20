-- A05 (SEC-08): audit chain version 2. Canonical format v2, the hashed
-- timestamp is the stored createdAt, nulls are normalized and every row has a
-- deterministic sequence number (lib/audit.ts).
--
-- Expand:
--   * chainVersion. Every row that exists when this runs is set to 1 (the
--     legacy chain, archived as is) BEFORE the default becomes 2. ADD COLUMN
--     ... DEFAULT 1 gives each existing row the value 1 without rewriting the
--     table; the UPDATE states it explicitly and matches no row when the fill
--     already holds. Only then is the default changed to 2.
--   * chainSequence. The nullable, unique position in the v2 chain, allocated
--     by lib/audit.ts under the chain advisory lock inside the inserting
--     transaction. Legacy rows keep NULL (NULLs never collide in a unique
--     index).
--
-- Enforce (existing rows already satisfy all three, so nothing is backfilled):
--   * CHECK: a row is either legacy (version 1, no sequence) or v2 (version 2
--     with a sequence).
--   * An insert without a sequence, such as code from before A05 still running
--     during the rollout, is stored as legacy (version 1) instead of claiming a
--     v2 position it does not have. It is never lost and never joins the chain.
--   * Legacy rows are an immutable archive: UPDATE and DELETE of a version-1
--     row raise.
--
-- previousHash and checksum are never rewritten and legacy checksums are never
-- recomputed. After review, scripts/checkpoint-audit-chain.ts records the
-- legacy count and digest as a v2 event (procedure: docs/security/audit-chain.md).
-- Prisma 6 does not model CHECK constraints or triggers; they are kept by hand
-- like the partial unique indexes of M01/M03 (no DROP of those indexes here).

-- Expand: chainVersion (existing rows = 1, then default 2).
ALTER TABLE "AuditLog" ADD COLUMN "chainVersion" INTEGER NOT NULL DEFAULT 1;
UPDATE "AuditLog" SET "chainVersion" = 1 WHERE "chainVersion" IS DISTINCT FROM 1;
ALTER TABLE "AuditLog" ALTER COLUMN "chainVersion" SET DEFAULT 2;

-- Expand: chainSequence.
ALTER TABLE "AuditLog" ADD COLUMN "chainSequence" BIGINT;
CREATE UNIQUE INDEX "AuditLog_chainSequence_key" ON "AuditLog"("chainSequence");

-- Enforce: version and sequence go together.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_chain_version_sequence" CHECK (
  ("chainVersion" = 1 AND "chainSequence" IS NULL)
  OR ("chainVersion" = 2 AND "chainSequence" IS NOT NULL)
);

-- Enforce: an unsequenced insert is a legacy row.
CREATE FUNCTION audit_log_unsequenced_is_legacy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."chainSequence" IS NULL THEN
    NEW."chainVersion" := 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_unsequenced_is_legacy"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION audit_log_unsequenced_is_legacy();

-- Enforce: the legacy archive is immutable.
CREATE FUNCTION audit_log_legacy_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog row % is part of the legacy (version 1) archive and cannot be changed', OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "AuditLog_legacy_immutable"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW WHEN (OLD."chainVersion" = 1)
EXECUTE FUNCTION audit_log_legacy_immutable();
