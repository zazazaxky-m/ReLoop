import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/internal/ws-session/route";
import { prisma } from "@/lib/prisma";
import * as auth from "@/lib/auth";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  verifySessionToken: vi.fn(),
}));

function makeRequest(body: unknown, secret = "test-secret") {
  return new NextRequest("http://localhost/api/internal/ws-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/ws-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REALTIME_INTERNAL_SECRET = "test-secret";
  });

  it("rejects unauthorized callers", async () => {
    const res = await POST(makeRequest({ token: "jwt" }, "wrong"));
    expect(res.status).toBe(401);
  });

  it("returns null role for invalid tokens", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(null);

    const res = await POST(makeRequest({ token: "bad" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.role).toBeNull();
  });

  it("returns null when tokenVersion is stale", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue({
      sub: "user-1",
      email: "a@b.c",
      name: "A",
      role: "ADMIN",
      organizationId: null,
      tokenVersion: 1,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      status: "ACTIVE",
      tokenVersion: 2,
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));
    const data = await res.json();

    expect(data.role).toBeNull();
  });

  it("returns live role for valid sessions", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue({
      sub: "user-1",
      email: "a@b.c",
      name: "A",
      role: "USER",
      organizationId: null,
      tokenVersion: 0,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      status: "ACTIVE",
      tokenVersion: 0,
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));
    const data = await res.json();

    expect(data.role).toBe("ADMIN");
  });
});
