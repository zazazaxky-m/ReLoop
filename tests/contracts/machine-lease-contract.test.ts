import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalLeaseV2,
  signLeaseV1,
  signLeaseV2,
  verifyLeaseV2,
  type LeaseV2Fields,
} from "@/lib/machine-lease";
import { canonicalSessionPolicy, sessionPolicyVersion, type MachinePolicyView } from "@/lib/session-policy";
import { machineLeaseContractV2 } from "../support/contracts";

/**
 * B01b: the cross-language lease v2 signature fixture. The same file is
 * asserted by tests/test_rvm_lease_contract.py with Python's json.dumps.
 */
const fixturePath = path.resolve(__dirname, "../fixtures/contracts/machine-lease.v2.json");
const document = JSON.parse(readFileSync(fixturePath, "utf8"));
const contract = machineLeaseContractV2.parse(document);

const fieldsOf = (lease: Record<string, unknown>): LeaseV2Fields => ({
  id: lease.id as string,
  machineCode: lease.machineCode as string,
  sessionId: lease.sessionId as string,
  userRef: lease.userRef as string | null,
  issuedAt: lease.issuedAt as number,
  expiresAt: lease.expiresAt as number,
  reservationId: lease.reservationId as string | null,
  policyVersion: lease.policyVersion as string,
  ceilingRupiah: lease.ceilingRupiah as number | null,
  maxItems: lease.maxItems as number | null,
});

describe("machine-lease v2 contract fixture", () => {
  it("is versioned and named after its contract", () => {
    expect(contract.version).toBe(2);
    expect(path.basename(fixturePath)).toBe(`${contract.contract}.v${contract.version}.json`);
  });

  for (const [name, entry] of Object.entries(contract.leases)) {
    it(`${name}: Node JSON.stringify produces the fixture's canonical bytes and the HMAC matches`, () => {
      const lease = entry.lease as Record<string, unknown>;
      const canonical = canonicalLeaseV2(fieldsOf(lease));
      expect(canonical).toBe(entry.canonical);
      expect(Buffer.from(canonical, "utf8").toString("utf8")).toBe(entry.canonical);
      expect(createHmac("sha256", contract.secret).update(canonical, "utf8").digest("hex")).toBe(lease.signature);
      const signed = signLeaseV2(contract.secret, fieldsOf(lease));
      expect(signed.signature).toBe(lease.signature);
      expect(verifyLeaseV2(contract.secret, lease, lease.machineCode as string)).toEqual({ ok: true });
    });

    it(`${name}: the policy snapshot canonical form and its version hash match`, () => {
      const policy = (entry.lease as { policy: MachinePolicyView }).policy;
      expect(canonicalSessionPolicy(policy)).toBe(entry.policyCanonical);
      expect(sessionPolicyVersion(policy)).toBe((entry.lease as { policyVersion: string }).policyVersion);
    });
  }

  it("refuses every tampered cap field (and every other signed field)", () => {
    const base = contract.leases.money.lease as Record<string, unknown>;
    for (const tamper of contract.tamper) {
      const tampered = { ...base, [tamper.field]: tamper.value };
      const verdict = verifyLeaseV2(contract.secret, tampered, base.machineCode as string);
      expect(verdict.ok, tamper.case).toBe(false);
    }
    // The caps are the point: each of the four cap fields alone breaks the signature.
    for (const field of ["reservationId", "policyVersion", "ceilingRupiah", "maxItems"]) {
      expect(contract.tamper.some((t) => t.field === field), field).toBe(true);
    }
  });

  it("refuses a lease whose policy snapshot no longer matches the signed policyVersion", () => {
    const base = contract.leases.money.lease as Record<string, unknown>;
    for (const tamper of contract.policyTamper) {
      const policy = structuredClone(base.policy) as Record<string, unknown>;
      let cursor: Record<string, unknown> | unknown[] = policy;
      const steps = tamper.path.slice(0, -1);
      for (const step of steps) cursor = (cursor as Record<string, unknown>)[step as string] as Record<string, unknown>;
      (cursor as Record<string, unknown>)[tamper.path.at(-1) as string] = tamper.value;
      const verdict = verifyLeaseV2(contract.secret, { ...base, policy }, base.machineCode as string);
      expect(verdict.ok, tamper.case).toBe(false);
    }
  });

  it("binds the lease to one machine: a lease for another machine code is refused", () => {
    const base = contract.leases.money.lease as Record<string, unknown>;
    expect(verifyLeaseV2(contract.secret, base, "AUDIT-B-01").ok).toBe(false);
  });

  it("refuses a v1 lease and non-integer bound values", () => {
    const v1 = { ...contract.legacyV1.lease };
    v1.signature = signLeaseV1(contract.secret, { id: v1.id, sessionId: v1.sessionId, issuedAt: v1.issuedAt, expiresAt: v1.expiresAt });
    expect(verifyLeaseV2(contract.secret, v1, "AUDIT-A-01").ok).toBe(false);
    const base = contract.leases.money.lease as Record<string, unknown>;
    expect(verifyLeaseV2(contract.secret, { ...base, ceilingRupiah: "10000" }, "AUDIT-A-01").ok).toBe(false);
    expect(verifyLeaseV2(contract.secret, { ...base, maxItems: 1.5 }, "AUDIT-A-01").ok).toBe(false);
    expect(verifyLeaseV2(contract.secret, { ...base, version: 1 }, "AUDIT-A-01").ok).toBe(false);
  });
});
