import { createHash, createHmac } from "node:crypto";
import { Prisma, type AuditLog } from "@prisma/client";
import { prisma } from "./prisma";

const INSECURE_DEFAULT = "audit-secret-change-me";
/** Stable advisory lock id serializing every audit chain append (and the legacy checkpoint). */
export const AUDIT_CHAIN_LOCK = 867_5309n;

/** Canonical format of every row written since A05 (SEC-08). */
export const AUDIT_CHAIN_VERSION = 2;
/** Rows written before A05: archived as is, never re-signed. */
export const LEGACY_AUDIT_CHAIN_VERSION = 1;

/** The v2 event that records the legacy archive's count and digest (scripts/checkpoint-audit-chain.ts). */
export const AUDIT_CHECKPOINT_ACTION = "AUDIT_CHAIN_CHECKPOINT";
export const AUDIT_CHECKPOINT_ENTITY = "AuditChain";
const AUDIT_CHECKPOINT_ENTITY_ID = "legacy-v1";

const SENSITIVE_METADATA_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "secret",
  "ingestsecret",
  "accountidentifier",
  "totpsecret",
  "qrcode",
  // Personal data: the hash chain cannot be rewritten on erasure.
  "email",
  "phone",
]);

/** Strips sensitive keys from audit metadata before persistence. */
export function redactAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // Nested objects are always defined records; redact never returns undefined here.
      redacted[key] = redactAuditMetadata(value as Record<string, unknown>)!;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Mirrors lib/auth.ts's getJwtSecret(): fail loudly in production instead
 * of silently signing the tamper-evident chain with a known default. */
function getAuditSecret(): string {
  const secret = process.env.AUDIT_CHECKSUM_SECRET;
  if (!secret || secret === INSECURE_DEFAULT) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUDIT_CHECKSUM_SECRET must be set in production");
    }
    return INSECURE_DEFAULT;
  }
  return secret;
}

export interface AuditEntryInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Exactly the stored columns the v2 checksum covers. */
export interface CanonicalAuditEntry {
  createdAt: Date;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadataJson: unknown;
}

/**
 * The value as PostgreSQL JSON hands it back: what JSON.stringify keeps
 * (undefined members dropped, Dates as ISO strings, non-finite numbers null).
 * The writer stores this form and the verifier reads it back, so both sides
 * hash the same value. Missing metadata and explicit null are both null.
 */
function asStoredJson(value: unknown): Prisma.JsonValue | null {
  if (value === undefined || value === null) return null;
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as Prisma.JsonValue);
}

/** JSON text with object keys sorted recursively, so JSONB key order never matters. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The single canonicalizer for writing and verifying v2 rows. Optional fields
 * normalize to null (omitted and explicit null are the same entry) and object
 * keys are sorted at every depth.
 */
export function canonicalAuditPayload(entry: CanonicalAuditEntry): string {
  return stableStringify({
    v: AUDIT_CHAIN_VERSION,
    createdAt: entry.createdAt.toISOString(),
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadataJson: asStoredJson(entry.metadataJson),
  });
}

/**
 * The single row builder: the timestamp is created once and stored as is, and
 * metadata is redacted and normalized to the form PostgreSQL returns.
 */
export function buildAuditRow(
  input: AuditEntryInput,
  createdAt: Date = new Date(),
): CanonicalAuditEntry & { metadataJson: Prisma.JsonValue | null } {
  return {
    createdAt,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadataJson: asStoredJson(redactAuditMetadata(input.metadata ?? undefined) ?? null),
  };
}

/** v2 link: HMAC over the position, the predecessor's checksum and the canonical row. */
function checksumV2(previousHash: string | null, sequence: bigint, canonical: string): string {
  return createHmac("sha256", getAuditSecret())
    .update(`reloop-audit-v${AUDIT_CHAIN_VERSION}\n${sequence.toString()}\n${previousHash ?? ""}\n${canonical}`)
    .digest("hex");
}

/**
 * Appends one v2 row. Under the chain lock it reads the head, allocates the
 * next sequence and stamps createdAt, then stores exactly what it hashed. The
 * row and its sequence live in the caller's transaction: a rollback discards
 * both, so the next writer reuses the number and links to the committed head
 * (no phantom link). The transaction must be READ COMMITTED (logAudit and
 * runWalletTransaction are) so the head read after the lock sees every
 * committed append; under a stale snapshot the unique sequence makes the
 * insert fail instead of forking the chain.
 *
 * `createdAt` is only for prisma/seed.ts's backdated demo history; production
 * writers leave it unset so the timestamp is taken after the lock.
 */
export async function appendAuditEntry(
  tx: Prisma.TransactionClient,
  input: AuditEntryInput,
  options: { createdAt?: Date } = {},
): Promise<{ id: string; chainSequence: bigint; checksum: string }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
  const head = await tx.auditLog.findFirst({
    where: { chainSequence: { not: null } },
    orderBy: { chainSequence: "desc" },
    select: { checksum: true, chainSequence: true },
  });
  const row = buildAuditRow(input, options.createdAt ?? new Date());
  const chainSequence = (head?.chainSequence ?? 0n) + 1n;
  const previousHash = head?.checksum ?? null;
  const checksum = checksumV2(previousHash, chainSequence, canonicalAuditPayload(row));
  const created = await tx.auditLog.create({
    data: {
      ...row,
      metadataJson: row.metadataJson === null ? Prisma.DbNull : (row.metadataJson as Prisma.InputJsonValue),
      chainVersion: AUDIT_CHAIN_VERSION,
      chainSequence,
      previousHash,
      checksum,
    },
    select: { id: true },
  });
  return { id: created.id, chainSequence, checksum };
}

/** Best-effort audit entry in its own transaction; a failure is logged, never thrown. */
export async function logAudit(input: AuditEntryInput): Promise<void> {
  try {
    await prisma.$transaction((tx) => appendAuditEntry(tx, input), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  } catch (err) {
    console.error("[AUDIT] failed to write log", err);
  }
}

/**
 * Appends an audit entry inside the caller's transaction, so the entry commits
 * or rolls back together with the change it records. Unlike `logAudit`, a
 * failure is thrown (a swallowed error would leave the transaction aborted).
 * The chain lock is held until the caller commits: call this last.
 */
export async function logAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: AuditEntryInput,
): Promise<void> {
  await appendAuditEntry(tx, input);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type LegacyAuditStatus = "not-present" | "unverifiable" | "valid";
export type LegacyCheckpointStatus = "not-required" | "missing" | "matches" | "mismatch";
export type AuditChainBreak = "version" | "sequence" | "previous-hash" | "checksum";

export interface AuditChainVerification {
  /** Validity of the v2 chain only. */
  valid: boolean;
  brokenAt?: string;
  reason?: AuditChainBreak;
  checkedVersion: typeof AUDIT_CHAIN_VERSION;
  checkedCount: number;
  /** The legacy (v1) archive, reported apart from the v2 chain. */
  legacyStatus: LegacyAuditStatus;
  legacyCount: number;
  /** Whether the legacy archive still matches the checkpoint recorded in the verified v2 chain. */
  legacyCheckpoint: LegacyCheckpointStatus;
}

export interface LegacyAuditSnapshot {
  count: number;
  /** sha256 over the stored legacy rows (no secret involved; recomputable by an operator). */
  digest: string;
  status: LegacyAuditStatus;
}

type AuditReader = Pick<Prisma.TransactionClient, "auditLog">;
type AuditRow = AuditLog;

/** The v1 writer's payload, reproduced only to check stored legacy checksums. */
function legacyV1Payload(entry: AuditRow): string {
  return JSON.stringify({
    ts: entry.createdAt.toISOString(),
    actor: entry.actorId,
    action: entry.action,
    entity: `${entry.entityType}:${entry.entityId}`,
    meta: entry.metadataJson,
  });
}

function checksumV1(previousHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${previousHash ?? ""}${payload}${getAuditSecret()}`)
    .digest("hex");
}

function legacyDigestLine(row: AuditRow): string {
  return stableStringify([
    row.id,
    row.createdAt.toISOString(),
    row.actorId,
    row.action,
    row.entityType,
    row.entityId,
    asStoredJson(row.metadataJson),
    row.previousHash,
    row.checksum,
  ]);
}

/**
 * Reads the legacy (v1) archive in (createdAt, id) order: its count, a digest
 * of every stored column, and whether every stored checksum still matches the
 * v1 formula over the stored row. The v1 writer hashed a timestamp it did not
 * store and serialized nulls differently from its verifier, so most legacy
 * rows cannot be proven; they are reported "unverifiable", never re-signed.
 */
export async function legacyAuditSnapshot(
  client: AuditReader = prisma,
  batchSize = 500,
): Promise<LegacyAuditSnapshot> {
  const digest = createHash("sha256").update(`reloop-audit-legacy-v${LEGACY_AUDIT_CHAIN_VERSION}\n`);
  let count = 0;
  let previous: string | null = null;
  let provable = true;
  let cursor: { createdAt: Date; id: string } | null = null;

  while (true) {
    const rows: AuditRow[] = await client.auditLog.findMany({
      where: {
        chainVersion: LEGACY_AUDIT_CHAIN_VERSION,
        ...(cursor
          ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    for (const row of rows) {
      digest.update(`${legacyDigestLine(row)}\n`);
      if (provable && (row.previousHash !== previous || row.checksum !== checksumV1(previous, legacyV1Payload(row)))) {
        provable = false;
      }
      previous = row.checksum;
      count += 1;
    }
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  return {
    count,
    digest: digest.digest("hex"),
    status: count === 0 ? "not-present" : provable ? "valid" : "unverifiable",
  };
}

interface RecordedCheckpoint {
  id: string;
  chainSequence: bigint;
  legacyCount: unknown;
  legacyDigest: unknown;
}

function readCheckpoint(row: AuditRow): RecordedCheckpoint {
  const meta = (row.metadataJson ?? {}) as Record<string, unknown>;
  return { id: row.id, chainSequence: row.chainSequence!, legacyCount: meta.legacyCount, legacyDigest: meta.legacyDigest };
}

function isCheckpointRow(row: AuditRow): boolean {
  return row.action === AUDIT_CHECKPOINT_ACTION && row.entityType === AUDIT_CHECKPOINT_ENTITY;
}

/**
 * Walks the v2 chain by chainSequence (never by timestamp): each row must be
 * version 2, at the next position, linked to the previous checksum, and carry
 * the HMAC of its stored canonical form. Remembers the last checkpoint event
 * in the verified part of the chain.
 */
async function walkV2Chain(client: AuditReader, batchSize: number) {
  let previous: string | null = null;
  let expected = 1n;
  let cursor: bigint | null = null;
  let checkedCount = 0;
  let checkpoint: RecordedCheckpoint | null = null;

  while (true) {
    const rows: AuditRow[] = await client.auditLog.findMany({
      where: { chainSequence: cursor === null ? { not: null } : { gt: cursor } },
      orderBy: { chainSequence: "asc" },
      take: batchSize,
    });
    for (const row of rows) {
      let reason: AuditChainBreak | null = null;
      if (row.chainVersion !== AUDIT_CHAIN_VERSION) reason = "version";
      else if (row.chainSequence !== expected) reason = "sequence";
      else if (row.previousHash !== previous) reason = "previous-hash";
      else if (row.checksum !== checksumV2(previous, expected, canonicalAuditPayload(row))) reason = "checksum";
      if (reason) return { valid: false as const, brokenAt: row.id, reason, checkedCount, checkpoint };
      if (isCheckpointRow(row)) checkpoint = readCheckpoint(row);
      previous = row.checksum;
      expected += 1n;
      checkedCount += 1;
    }
    if (rows.length < batchSize) break;
    cursor = rows[rows.length - 1].chainSequence;
  }

  // A row that is neither legacy nor sequenced cannot be placed in the chain
  // (the database CHECK forbids it; this guards a dropped constraint).
  const stray = await client.auditLog.findFirst({
    where: { chainSequence: null, chainVersion: { not: LEGACY_AUDIT_CHAIN_VERSION } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (stray) return { valid: false as const, brokenAt: stray.id, reason: "sequence" as const, checkedCount, checkpoint };
  return { valid: true as const, checkedCount, checkpoint };
}

function checkpointStatus(checkpoint: RecordedCheckpoint | null, legacy: LegacyAuditSnapshot): LegacyCheckpointStatus {
  if (!checkpoint) return legacy.count === 0 ? "not-required" : "missing";
  return checkpoint.legacyCount === legacy.count && checkpoint.legacyDigest === legacy.digest ? "matches" : "mismatch";
}

/**
 * Verifies the v2 chain and, separately, reports the legacy archive. A legacy
 * archive that cannot be proven never makes the v2 chain invalid, and is never
 * reported valid unless every stored legacy checksum matches.
 */
export async function verifyAuditChain(options?: {
  batchSize?: number;
  client?: AuditReader;
}): Promise<AuditChainVerification> {
  const batchSize = options?.batchSize ?? 500;
  const client = options?.client ?? prisma;
  const chain = await walkV2Chain(client, batchSize);
  const legacy = await legacyAuditSnapshot(client, batchSize);
  return {
    valid: chain.valid,
    ...(chain.valid ? {} : { brokenAt: chain.brokenAt, reason: chain.reason }),
    checkedVersion: AUDIT_CHAIN_VERSION,
    checkedCount: chain.checkedCount,
    legacyStatus: legacy.status,
    legacyCount: legacy.count,
    legacyCheckpoint: checkpointStatus(chain.checkpoint, legacy),
  };
}

// ---------------------------------------------------------------------------
// Legacy checkpoint (scripts/checkpoint-audit-chain.ts)
// ---------------------------------------------------------------------------

export type LegacyCheckpointOutcome =
  | "dry-run"
  | "written"
  | "already-recorded"
  | "digest-mismatch"
  | "checkpoint-conflict"
  | "nothing-to-checkpoint";

export interface LegacyCheckpointReport {
  outcome: LegacyCheckpointOutcome;
  legacyVersion: typeof LEGACY_AUDIT_CHAIN_VERSION;
  legacyCount: number;
  legacyDigest: string;
  legacyStatus: LegacyAuditStatus;
  /** The checkpoint already recorded (or just written), if any. */
  checkpoint: { id: string; chainSequence: string; legacyCount: unknown; legacyDigest: unknown } | null;
}

async function latestCheckpoint(client: AuditReader): Promise<RecordedCheckpoint | null> {
  const row = await client.auditLog.findFirst({
    where: { action: AUDIT_CHECKPOINT_ACTION, entityType: AUDIT_CHECKPOINT_ENTITY, chainSequence: { not: null } },
    orderBy: { chainSequence: "desc" },
  });
  return row ? readCheckpoint(row) : null;
}

function report(
  outcome: LegacyCheckpointOutcome,
  legacy: LegacyAuditSnapshot,
  checkpoint: RecordedCheckpoint | null,
): LegacyCheckpointReport {
  return {
    outcome,
    legacyVersion: LEGACY_AUDIT_CHAIN_VERSION,
    legacyCount: legacy.count,
    legacyDigest: legacy.digest,
    legacyStatus: legacy.status,
    checkpoint: checkpoint
      ? { id: checkpoint.id, chainSequence: checkpoint.chainSequence.toString(), legacyCount: checkpoint.legacyCount, legacyDigest: checkpoint.legacyDigest }
      : null,
  };
}

/**
 * Dry run (default): reads the legacy archive's count and digest in one
 * read-only snapshot and writes nothing. Apply: under the chain lock and a
 * table lock that holds every audit write still, recomputes the digest and
 * appends the v2 checkpoint event only when it equals `expectedDigest` (the
 * digest an operator reviewed) and no checkpoint exists yet. Legacy rows are
 * never modified or re-signed. The report never contains the secret.
 */
export async function checkpointLegacyAuditChain(
  options: { apply?: false } | { apply: true; expectedDigest: string } = {},
): Promise<LegacyCheckpointReport> {
  if (!options.apply) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const legacy = await legacyAuditSnapshot(tx);
      const existing = await latestCheckpoint(tx);
      return report("dry-run", legacy, existing);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000, maxWait: 10_000 });
  }

  const { expectedDigest } = options;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
    await tx.$executeRaw`LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE`;
    const legacy = await legacyAuditSnapshot(tx);
    const existing = await latestCheckpoint(tx);
    if (existing) {
      const same = existing.legacyCount === legacy.count && existing.legacyDigest === legacy.digest;
      return report(same ? "already-recorded" : "checkpoint-conflict", legacy, existing);
    }
    if (legacy.count === 0) return report("nothing-to-checkpoint", legacy, null);
    if (legacy.digest !== expectedDigest) return report("digest-mismatch", legacy, null);
    const written = await appendAuditEntry(tx, {
      actorId: null,
      action: AUDIT_CHECKPOINT_ACTION,
      entityType: AUDIT_CHECKPOINT_ENTITY,
      entityId: AUDIT_CHECKPOINT_ENTITY_ID,
      metadata: {
        boundary: `v${LEGACY_AUDIT_CHAIN_VERSION}->v${AUDIT_CHAIN_VERSION}`,
        legacyVersion: LEGACY_AUDIT_CHAIN_VERSION,
        legacyCount: legacy.count,
        legacyDigest: legacy.digest,
        legacyStatus: legacy.status,
      },
    });
    return report("written", legacy, {
      id: written.id, chainSequence: written.chainSequence, legacyCount: legacy.count, legacyDigest: legacy.digest,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000, maxWait: 10_000 });
}
