import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, DELETE } from "@/app/api/user/data/route";
import * as rbac from "@/lib/rbac";
import * as gdpr from "@/lib/gdpr";

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock("@/lib/gdpr", () => ({
  createUserDataExportStream: vi.fn(),
  processErasureRequest: vi.fn(),
}));

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

    it("processes erasure request if user is USER", async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: "u1", role: "USER" } as any);
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(gdpr.processErasureRequest).toHaveBeenCalledWith("u1");
    });

    it("handles errors", async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error("auth failed"));
      const res = await DELETE();
      expect(res.status).toBe(500);
    });
  });
});
