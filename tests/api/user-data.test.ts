import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, DELETE } from "@/app/api/user/data/route";
import * as rbac from "@/lib/rbac";
import * as gdpr from "@/lib/gdpr";
import * as erasure from "@/lib/erasure-jobs";

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock("@/lib/gdpr", () => ({
  createUserDataExportStream: vi.fn(),
}));

vi.mock('@/lib/erasure-jobs', () => ({
  ERASURE_ONLY_USERS: 'Hanya pengguna biasa yang dapat menghapus data',
  requestErasure: vi.fn(),
  runErasureJob: vi.fn(),
  getErasureStatus: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ clearSessionCookie: vi.fn() }));

describe("/api/user/data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns export stream", async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "u1" } as any);
      vi.mocked(gdpr.createUserDataExportStream).mockReturnValue("mock-stream" as any);

      const res = await GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Content-Disposition")).toContain("u1.json");
    });

    it("handles errors", async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error("auth failed"));
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE", () => {
    it("returns 403 if user is not USER", async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "a1", role: "ADMIN" } as any);
      const res = await DELETE();
      expect(res.status).toBe(403);
    });

    it("reports a retrying erasure as not completed (202)", async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "u1", role: "USER" } as any);
      vi.mocked(erasure.requestErasure).mockResolvedValue({ requestId: "r1", status: "PROCESSING" });
      vi.mocked(erasure.runErasureJob).mockRejectedValue(new Error("db down"));
      vi.mocked(erasure.getErasureStatus).mockResolvedValue({ requestId: "r1", status: "RETRYABLE_FAILED", completed: false, accountErased: false } as any);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await DELETE();
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ status: "RETRYABLE_FAILED", completed: false });
    });

    it("handles errors", async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error("auth failed"));
      const res = await DELETE();
      expect(res.status).toBe(500);
    });
  });
});
