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

  it("rejects when bearer length differs from secret", async () => {
    const res = await POST(makeRequest({ token: "jwt" }, "x"));
    expect(res.status).toBe(401);
  });

  it("accepts missing Authorization header as unauthorized", async () => {
    const req = new NextRequest("http://localhost/api/internal/ws-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "jwt" }),
    });
    const res = await POST(req);
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

  it("treats missing tokenVersion on payload and user as 0", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue({
      sub: "user-1",
      email: "a@b.c",
      name: "A",
      role: "USER",
      organizationId: null,
    } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
      tokenVersion: null,
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));
    expect((await res.json()).role).toBe("USER");
  });

  it("rejects when REALTIME_INTERNAL_SECRET is unset", async () => {
    delete process.env.REALTIME_INTERNAL_SECRET;
    const res = await POST(makeRequest({ token: "jwt" }));
    expect(res.status).toBe(401);
  });

  it("returns null role when user is missing or inactive", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue({
      sub: "user-1",
      email: "a@b.c",
      name: "A",
      role: "USER",
      organizationId: null,
      tokenVersion: 0,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    let res = await POST(makeRequest({ token: "jwt" }));
    expect((await res.json()).role).toBeNull();

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "USER",
      status: "INACTIVE",
      tokenVersion: 0,
    } as never);
    res = await POST(makeRequest({ token: "jwt" }));
    expect((await res.json()).role).toBeNull();
  });

  it("handles validation errors", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
  });
});
