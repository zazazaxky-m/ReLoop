import { createHmac, timingSafeEqual } from "node:crypto";
import { MACHINE_LEASE_PROTOCOL_VERSION } from "./machine-auth-constants";
import { sessionPolicyVersion, type MachinePolicyView } from "./session-policy";

/**
 * Session lease signing (B01b). Shared contract fixture:
 * tests/fixtures/contracts/machine-lease.v2.json; RVM side: rvm/lease.py.
 *
 * v2 canonical form: the compact UTF-8 JSON array
 *   [2, id, machineCode, sessionId, userRef, issuedAt, expiresAt,
 *    reservationId, policyVersion, ceilingRupiah, maxItems]
 * signed with HMAC-SHA256(machine ingest secret). Node `JSON.stringify(array)`
 * and Python `json.dumps(array, separators=(",", ":"), ensure_ascii=False)`
 * produce identical bytes as long as every number is an integer and an absent
 * bound is null, which `assertLeaseV2Fields` guarantees before signing.
 *
 * v1 (workers that do not announce protocol 2): `id.sessionId.issuedAt.expiresAt`,
 * unchanged since R03.
 */

export interface LeaseV2Fields {
  id: string;
  machineCode: string;
  sessionId: string;
  userRef: string | null;
  issuedAt: number;
  expiresAt: number;
  reservationId: string | null;
  /** sha256 hex of the admission snapshot (lib/session-policy.ts). */
  policyVersion: string;
  ceilingRupiah: number | null;
  maxItems: number | null;
}

export interface LeaseV2 extends LeaseV2Fields {
  version: typeof MACHINE_LEASE_PROTOCOL_VERSION;
  policy: MachinePolicyView;
  signature: string;
}

export type LeaseVerdict = { ok: true } | { ok: false; reason: string };

const HEX64 = /^[0-9a-f]{64}$/;

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Throws unless every field has the exact JSON type the canonical form requires. */
export function assertLeaseV2Fields(fields: Record<string, unknown>): asserts fields is LeaseV2Fields & Record<string, unknown> {
  if (!isNonEmptyString(fields.id)) throw new TypeError("lease.id must be a non-empty string");
  if (!isNonEmptyString(fields.machineCode)) throw new TypeError("lease.machineCode must be a non-empty string");
  if (!isNonEmptyString(fields.sessionId)) throw new TypeError("lease.sessionId must be a non-empty string");
  if (!(fields.userRef === null || isNonEmptyString(fields.userRef))) throw new TypeError("lease.userRef must be a string or null");
  if (!isInt(fields.issuedAt) || fields.issuedAt <= 0) throw new TypeError("lease.issuedAt must be a positive integer");
  if (!isInt(fields.expiresAt) || fields.expiresAt <= 0) throw new TypeError("lease.expiresAt must be a positive integer");
  if (!(fields.reservationId === null || isNonEmptyString(fields.reservationId))) throw new TypeError("lease.reservationId must be a string or null");
  if (!isNonEmptyString(fields.policyVersion) || !HEX64.test(fields.policyVersion)) throw new TypeError("lease.policyVersion must be a sha256 hex");
  if (!(fields.ceilingRupiah === null || (isInt(fields.ceilingRupiah) && fields.ceilingRupiah >= 0))) {
    throw new TypeError("lease.ceilingRupiah must be a non-negative integer or null");
  }
  if (!(fields.maxItems === null || (isInt(fields.maxItems) && fields.maxItems >= 1))) {
    throw new TypeError("lease.maxItems must be a positive integer or null");
  }
}

export function canonicalLeaseV2(fields: LeaseV2Fields): string {
  assertLeaseV2Fields(fields as unknown as Record<string, unknown>);
  return JSON.stringify([
    MACHINE_LEASE_PROTOCOL_VERSION,
    fields.id,
    fields.machineCode,
    fields.sessionId,
    fields.userRef,
    fields.issuedAt,
    fields.expiresAt,
    fields.reservationId,
    fields.policyVersion,
    fields.ceilingRupiah,
    fields.maxItems,
  ]);
}

function hmacHex(secret: string, canonical: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export function signLeaseV2(secret: string, fields: LeaseV2Fields): LeaseV2Fields & { version: 2; signature: string } {
  const signature = hmacHex(secret, canonicalLeaseV2(fields));
  return { version: MACHINE_LEASE_PROTOCOL_VERSION, ...fields, signature };
}

export function signLeaseV1(secret: string, lease: { id: string; sessionId: string; issuedAt: number; expiresAt: number }): string {
  return createHmac("sha256", secret).update([lease.id, lease.sessionId, lease.issuedAt, lease.expiresAt].join(".")).digest("hex");
}

/**
 * Verifies a lease object exactly like the RVM does (rvm/lease.py): version
 * 2, well-typed fields, the lease's machine code equal to the verifying
 * machine, the HMAC over the canonical array, and a snapshot whose hash is
 * the signed `policyVersion`.
 */
export function verifyLeaseV2(secret: string, lease: Record<string, unknown>, machineCode: string): LeaseVerdict {
  if (lease.version !== MACHINE_LEASE_PROTOCOL_VERSION) return { ok: false, reason: "LEASE_VERSION" };
  try {
    assertLeaseV2Fields(lease);
  } catch (error) {
    return { ok: false, reason: `LEASE_FIELDS: ${(error as Error).message}` };
  }
  if (lease.machineCode !== machineCode) return { ok: false, reason: "LEASE_MACHINE_MISMATCH" };
  if (!isNonEmptyString(lease.signature) || !HEX64.test(lease.signature)) return { ok: false, reason: "LEASE_SIGNATURE_FORMAT" };
  const expected = Buffer.from(hmacHex(secret, canonicalLeaseV2(lease)), "utf8");
  const given = Buffer.from(lease.signature, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "LEASE_SIGNATURE" };
  const policy = lease.policy;
  if (!policy || typeof policy !== "object") return { ok: false, reason: "LEASE_POLICY_MISSING" };
  let hash: string;
  try {
    hash = sessionPolicyVersion(policy as MachinePolicyView);
  } catch {
    return { ok: false, reason: "LEASE_POLICY_MALFORMED" };
  }
  if (hash !== lease.policyVersion) return { ok: false, reason: "LEASE_POLICY_MISMATCH" };
  return { ok: true };
}
