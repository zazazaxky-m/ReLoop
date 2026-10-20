import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/audit/verify/route";
import * as rbac from "@/lib/rbac";
import * as audit from "@/lib/audit";

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/audit", () => ({
  verifyAuditChain: vi.fn(),
}));

const VALID = {
  valid: true,
  checkedVersion: 2 as const,
  checkedCount: 5,
  legacyStatus: "unverifiable" as const,
  legacyCount: 12,
  legacyCheckpoint: "matches" as const,
};

describe("POST /api/audit/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires SUPERADMIN", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(
      new (rbac as any).HttpError(403, "Akses ditolak"),
    );

    const res = await POST();
    expect(res.status).toBe(403);
    expect(audit.verifyAuditChain).not.toHaveBeenCalled();
  });

  it("returns the v2 chain validity and the legacy status as separate fields", async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "sa1", role: "SUPERADMIN" } as any);
    vi.mocked(audit.verifyAuditChain).mockResolvedValue(VALID);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
    expect(audit.verifyAuditChain).toHaveBeenCalled();
  });

  it("returns where and why the v2 chain broke, and nothing beyond the contract", async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "sa1", role: "SUPERADMIN" } as any);
    vi.mocked(audit.verifyAuditChain).mockResolvedValue({
      ...VALID, valid: false, brokenAt: "row-3", reason: "sequence", legacyStatus: "not-present", legacyCount: 0,
      legacyCheckpoint: "not-required", internal: "must-not-leak",
    } as any);

    const body = await (await POST()).json();
    expect(body).toEqual({
      valid: false, brokenAt: "row-3", reason: "sequence", checkedVersion: 2, checkedCount: 5,
      legacyStatus: "not-present", legacyCount: 0, legacyCheckpoint: "not-required",
    });
  });
});
