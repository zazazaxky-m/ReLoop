import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "./prisma";

const sendEachForMulticast = vi.fn(() => Promise.resolve({ successCount: 1 }));
const messagingMock = { sendEachForMulticast };
const initializeApp = vi.fn(() => ({ messaging: () => messagingMock }));
const appFn = vi.fn(() => ({ messaging: () => messagingMock }));

vi.mock("firebase-admin", () => ({
  default: {
    apps: [],
    initializeApp,
    credential: { cert: vi.fn(() => ({})) },
    app: appFn,
  },
}));

vi.mock("./prisma", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    deviceToken: { findMany: vi.fn() },
  },
}));

describe("lib/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", JSON.stringify({ projectId: "x" }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates notification row", async () => {
    vi.resetModules();
    const { createNotification } = await import("./notifications");
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "n1" } as never);
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as never);
    const res = await createNotification({
      userId: "u1",
      type: "SYSTEM" as any,
      title: "hi",
      body: "hello",
      data: { k: 1 },
    });
    expect(res.id).toBe("n1");
    // Push is fire-and-forget behind a dynamic import, so poll instead of
    // assuming one macrotask is enough (also keeps it from leaking into later tests).
    await vi.waitFor(() => expect(sendEachForMulticast).toHaveBeenCalled());
  });

  it("gets unread count", async () => {
    const { getUnreadCount } = await import("./notifications");
    vi.mocked(prisma.notification.count).mockResolvedValue(5);
    await expect(getUnreadCount("u1")).resolves.toBe(5);
  });

  it("lists notifications", async () => {
    const { listNotifications } = await import("./notifications");
    vi.mocked(prisma.notification.findMany).mockResolvedValue([{ id: "n1" }] as never);
    const res = await listNotifications("u1");
    expect(res).toHaveLength(1);
  });

  it("marks notifications read by ids", async () => {
    const { markNotificationsRead } = await import("./notifications");
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 2 } as never);
    const count = await markNotificationsRead("u1", ["n1", "n2"]);
    expect(count).toBe(2);
  });

  it("marks all unread read when ids omitted", async () => {
    const { markNotificationsRead } = await import("./notifications");
    vi.mocked(prisma.notification.updateMany).mockResolvedValue({ count: 3 } as never);
    const count = await markNotificationsRead("u1");
    expect(count).toBe(3);
  });

  it("sends push to users best effort", async () => {
    vi.resetModules();
    const { sendPushToUsersBestEffort } = await import("./notifications");
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as never);
    await sendPushToUsersBestEffort(["u1"], "title", "body");
    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ["t1"] }),
    );
  });

  it("skips push when user has no device tokens", async () => {
    vi.resetModules();
    const { sendPushToUsersBestEffort } = await import("./notifications");
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([]);
    await sendPushToUsersBestEffort(["u1"], "title", "body", { a: 1 });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("createNotification skips push when recipient has no tokens", async () => {
    vi.resetModules();
    const { createNotification } = await import("./notifications");
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "n2" } as never);
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([]);
    await createNotification({
      userId: "u1",
      type: "SYSTEM" as any,
      title: "t",
      body: "b",
    });
    // Wait until the background push reaches the token lookup (after firebase
    // init) so its initializeApp call can't land in the next test.
    await vi.waitFor(() => expect(prisma.deviceToken.findMany).toHaveBeenCalled());
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("reuses cached firebase app on second push", async () => {
    vi.resetModules();
    const { sendPushToUsersBestEffort } = await import("./notifications");
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as never);
    await sendPushToUsersBestEffort(["u1"], "a", "b");
    await sendPushToUsersBestEffort(["u1"], "c", "d");
    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("short-circuits after firebase is marked unavailable", async () => {
    vi.resetModules();
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "");
    const { sendPushToUsersBestEffort } = await import("./notifications");
    await sendPushToUsersBestEffort(["u1"], "x", "y");
    await sendPushToUsersBestEffort(["u1"], "x2", "y2");
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("reuses existing firebase admin app when apps already registered", async () => {
    vi.resetModules();
    const admin = await import("firebase-admin");
    (admin.default as any).apps = [{}];
    const { sendPushToUsersBestEffort } = await import("./notifications");
    vi.mocked(prisma.deviceToken.findMany).mockResolvedValue([{ token: "t1" }] as never);
    await sendPushToUsersBestEffort(["u1"], "t", "b");
    expect(appFn).toHaveBeenCalled();
    (admin.default as any).apps = [];
  });
});
