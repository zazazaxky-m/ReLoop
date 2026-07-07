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
  });

  it("returns chain verification result", async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "sa1", role: "SUPERADMIN" } as any);
    vi.mocked(audit.verifyAuditChain).mockResolvedValue({ valid: true });

    const res = await POST();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.valid).toBe(true);
    expect(audit.verifyAuditChain).toHaveBeenCalled();
  });
});
