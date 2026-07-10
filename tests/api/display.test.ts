import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/display/[code]/route";
import { prisma } from "@/lib/prisma";
import { verifyMachineRequest } from "@/lib/machine-auth";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/prisma", () => ({
  prisma: { machine: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/machine-auth", () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/qr", () => ({
  buildScanUrl: vi.fn(() => "https://reloop.test/scan?machine=RLP-001&token=t1"),
  qrDataUrl: vi.fn(async () => "data:image/png;base64,qr"),
  rotateToken: vi.fn(),
}));

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/display/RLP-001", { headers });
}

describe("GET /api/display/[code]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() } as any);
  });

  it("requires a valid machine HMAC before returning QR data", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "m1",
      machineCode: "RLP-001",
      ingestSecret: "secret",
    } as any);
    vi.mocked(verifyMachineRequest).mockResolvedValue({ ok: false, reason: "MISSING_HEADERS" });

    const res = await GET(req(), { params: Promise.resolve({ code: "RLP-001" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a signed request for a different machine code", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "m1",
      machineCode: "RLP-001",
      ingestSecret: "secret",
    } as any);
    vi.mocked(verifyMachineRequest).mockResolvedValue({ ok: true });

    const res = await GET(req({ "x-reloop-machine": "OTHER" }), {
      params: Promise.resolve({ code: "RLP-001" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns QR data for a signed machine request", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "m1",
      machineCode: "RLP-001",
      name: "Mesin 1",
      status: "ONLINE",
      ingestSecret: "secret",
      qrToken: "t1",
      qrTokenExpiresAt: new Date(Date.now() + 30_000),
      qrRotationSeconds: 30,
    } as any);
    vi.mocked(verifyMachineRequest).mockResolvedValue({ ok: true });

    const res = await GET(req({ "x-reloop-machine": "RLP-001" }), {
      params: Promise.resolve({ code: "RLP-001" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scanUrl).toContain("token=t1");
    expect(data.qrDataUrl).toBe("data:image/png;base64,qr");
  });

  it("rate limits display requests", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as any);
    const res = await GET(req(), { params: Promise.resolve({ code: "RLP-001" }) });
    expect(res.status).toBe(429);
  });

  it("returns 404 when machine is missing", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ code: "MISSING" }) });
    expect(res.status).toBe(404);
  });

  it("rotates expired QR tokens before returning", async () => {
    const { rotateToken } = await import("@/lib/qr");
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "m1",
      machineCode: "RLP-001",
      name: "Mesin 1",
      status: "ONLINE",
      ingestSecret: "secret",
      qrToken: "old",
      qrTokenExpiresAt: new Date(Date.now() - 1_000),
      qrRotationSeconds: 30,
    } as any);
    vi.mocked(verifyMachineRequest).mockResolvedValue({ ok: true });
    vi.mocked(rotateToken).mockResolvedValue({
      token: "fresh",
      expiresAt: new Date(Date.now() + 30_000),
    } as any);

    const res = await GET(req({ "x-reloop-machine": "RLP-001" }), {
      params: Promise.resolve({ code: "RLP-001" }),
    });
    expect(res.status).toBe(200);
    expect(rotateToken).toHaveBeenCalledWith("m1", 30);
  });

  it("returns 500 when rotated token is empty", async () => {
    const { rotateToken } = await import("@/lib/qr");
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "m1",
      machineCode: "RLP-001",
      ingestSecret: "secret",
      qrToken: null,
      qrTokenExpiresAt: null,
      qrRotationSeconds: 30,
    } as any);
    vi.mocked(verifyMachineRequest).mockResolvedValue({ ok: true });
    vi.mocked(rotateToken).mockResolvedValue({ token: "", expiresAt: new Date() } as any);

    const res = await GET(req({ "x-reloop-machine": "RLP-001" }), {
      params: Promise.resolve({ code: "RLP-001" }),
    });
    expect(res.status).toBe(500);
  });

  it("returns handled error on unexpected failure", async () => {
    vi.mocked(prisma.machine.findUnique).mockRejectedValue(new Error("db boom"));
    const res = await GET(req(), { params: Promise.resolve({ code: "RLP-001" }) });
    expect(res.status).toBe(500);
  });
});
