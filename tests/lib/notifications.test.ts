import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import {
  createNotification,
  sendPushToUsersBestEffort,
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    deviceToken: {
      findMany: vi.fn(),
    },
  },
}));

describe("notifications", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("createNotification creates notification and does not crash if no firebase", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "1" } as any);
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    const notif = await createNotification({
      userId: "u1",
      type: "PICKUP_ASSIGNED",
      title: "Test",
      body: "Test body",
    });

    expect(notif.id).toBe("1");
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it("createNotification attempts to send push if firebase is available", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"test"}';
    const sendEachForMulticast = vi.fn().mockResolvedValue({});

    vi.doMock("firebase-admin", () => ({
      default: {
        apps: [],
        initializeApp: vi.fn().mockReturnValue({
          messaging: () => ({ sendEachForMulticast }),
        }),
        credential: { cert: vi.fn() },
      },
    }));

    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "2" } as any);
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t2" }] as any);

    const mod = await import("@/lib/notifications");
    await mod.createNotification({
      userId: "u2",
      type: "TRIP_STATUS",
      title: "Test",
      body: "Test body",
      data: { tripId: "t1" },
    });

    // Wait for the unawaited best-effort push (may need a few ticks under coverage).
    for (let i = 0; i < 10 && vi.mocked(prisma.deviceToken.findMany).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(prisma.deviceToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u2" } }),
    );
    expect(sendEachForMulticast).toHaveBeenCalled();
  });

  it("getUnreadCount returns count", async () => {
    vi.mocked(prisma.notification.count).mockResolvedValue(5);
    const c = await getUnreadCount("u1");
    expect(c).toBe(5);
  });

  it("listNotifications returns notifications", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([{ id: "1" }] as any);
    const list = await listNotifications("u1");
    expect(list).toHaveLength(1);
  });

  it("markNotificationsRead marks all or specific", async () => {
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 2 } as any);
    
    const c = await markNotificationsRead("u1");
    expect(c).toBe(2);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", readAt: null } })
    );

    await markNotificationsRead("u1", ["1"]);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", readAt: null, id: { in: ["1"] } } })
    );
  });

  it("sendPushToUsersBestEffort does nothing if empty users", async () => {
    await sendPushToUsersBestEffort([], "t", "b");
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });

  describe("firebase push", () => {
    it("fails silently if firebase fails to load", async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"test"}';
      
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      vi.doMock("firebase-admin", () => {
        throw new Error("mock load fail");
      });

      // need to dynamically import to catch the domock
      const mod = await import("@/lib/notifications");
      await mod.sendPushToUsersBestEffort(["u1"], "t", "b");
      
      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });

    it("sends push if firebase is configured and tokens exist", async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"test"}';

      const sendEachForMulticast = vi.fn().mockResolvedValue({});
      
      vi.doMock("firebase-admin", () => ({
        default: {
          apps: [],
          initializeApp: vi.fn().mockReturnValue({
            messaging: () => ({ sendEachForMulticast })
          }),
          credential: { cert: vi.fn() },
          app: () => ({
            messaging: () => ({ sendEachForMulticast }),
          }),
        },
      }));

      vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as any);

      const mod = await import("@/lib/notifications");
      await mod.sendPushToUsersBestEffort(["u1"], "Title", "Body", { url: "/test" });

      expect(prisma.deviceToken.findMany).toHaveBeenCalled();
      expect(sendEachForMulticast).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: ["t1"],
          notification: { title: "Title", body: "Body" },
          data: { url: "/test" },
        })
      );
    });

    it("swallows send errors", async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"test"}';

      const sendEachForMulticast = vi.fn().mockRejectedValue(new Error("send error"));
      
      vi.doMock("firebase-admin", () => ({
        default: {
          apps: [1],
          app: () => ({
            messaging: () => ({ sendEachForMulticast }),
          }),
        },
      }));

      vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as any);
      
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const mod = await import("@/lib/notifications");
      await mod.sendPushToUsersBestEffort(["u1"], "Title", "Body");

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("swallows per-user push send failures from createNotification", async () => {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"project_id":"test"}';
      const sendEachForMulticast = vi.fn().mockRejectedValue(new Error("push boom"));

      vi.doMock("firebase-admin", () => ({
        default: {
          apps: [1],
          app: () => ({
            messaging: () => ({ sendEachForMulticast }),
          }),
        },
      }));

      vi.mocked(prisma.notification.create).mockResolvedValue({ id: "n1" } as any);
      vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as any);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const mod = await import("@/lib/notifications");
      await mod.createNotification({
        userId: "u1",
        type: "PICKUP_ASSIGNED",
        title: "T",
        body: "B",
      });

      for (let i = 0; i < 20 && consoleError.mock.calls.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(consoleError).toHaveBeenCalledWith(
        "[notifications] push send failed:",
        expect.any(Error),
      );
      consoleError.mockRestore();
    });
  });
});
