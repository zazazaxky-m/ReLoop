import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
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

const NOW_SECONDS = 1_900_000_000;
const sessionPayload = (overrides: Record<string, unknown> = {}) => ({
  sub: "user-1",
  email: "a@b.c",
  name: "A",
  role: "USER" as const,
  organizationId: null,
  tokenVersion: 0,
  expiresAt: NOW_SECONDS + 600,
  ...overrides,
});

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
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_SECONDS * 1000);
    process.env.REALTIME_INTERNAL_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("returns null for invalid tokens", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(null);

    const res = await POST(makeRequest({ token: "bad" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when tokenVersion is stale", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(sessionPayload({ role: "ADMIN", tokenVersion: 1 }));
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      status: "ACTIVE",
      tokenVersion: 2,
      organizationId: "org-a",
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));

    expect(await res.json()).toBeNull();
  });

  it("returns the live identity: role and organization from the database, expiry from the verified token", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(
      sessionPayload({ role: "USER", organizationId: "org-from-token" }),
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      status: "ACTIVE",
      tokenVersion: 0,
      organizationId: "org-a",
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-1",
      role: "ADMIN",
      organizationId: "org-a",
      tokenVersion: 0,
      expiresAt: NOW_SECONDS + 600,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { role: true, status: true, tokenVersion: true, organizationId: true },
    });
  });

  it("returns null once the verified session expiry has passed", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(sessionPayload({ expiresAt: NOW_SECONDS }));
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN", status: "ACTIVE", tokenVersion: 0, organizationId: "org-a",
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));

    expect(await res.json()).toBeNull();
  });

  it("never grants an identity without a verified expiry", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(sessionPayload({ expiresAt: undefined }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN", status: "ACTIVE", tokenVersion: 0, organizationId: "org-a",
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));

    expect(await res.json()).toBeNull();
  });

  it("rejects missing tokenVersion on payload and user", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(sessionPayload({ tokenVersion: undefined }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "USER",
      status: "ACTIVE",
      tokenVersion: null,
      organizationId: null,
    } as never);

    const res = await POST(makeRequest({ token: "jwt" }));
    expect(await res.json()).toBeNull();
  });

  it("rejects when REALTIME_INTERNAL_SECRET is unset", async () => {
    delete process.env.REALTIME_INTERNAL_SECRET;
    const res = await POST(makeRequest({ token: "jwt" }));
    expect(res.status).toBe(401);
  });

  it("returns null when the user is missing, inactive or suspended", async () => {
    vi.mocked(auth.verifySessionToken).mockResolvedValue(sessionPayload());
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    let res = await POST(makeRequest({ token: "jwt" }));
    expect(await res.json()).toBeNull();

    for (const status of ["INACTIVE", "SUSPENDED"]) {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        role: "ADMIN",
        status,
        tokenVersion: 0,
        organizationId: "org-a",
      } as never);
      res = await POST(makeRequest({ token: "jwt" }));
      expect(await res.json()).toBeNull();
    }
  });

  it("handles validation errors", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
  });
});
