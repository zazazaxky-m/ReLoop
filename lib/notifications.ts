import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditTransportSink, captureTransport } from "./test-transport";

export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

/**
 * Writes the in-app notification row (source of truth for the badge/list in
 * both web and mobile) and, best-effort, fans it out over FCM if the
 * recipient has a registered device and firebase-admin is configured. Push
 * failures are swallowed — the in-app row is what actually matters and must
 * never be lost because a push provider hiccuped.
 */
export async function createNotification(
  params: CreateNotificationParams,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const notification = await db.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      dataJson: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  void sendPushBestEffort(params.userId, params.title, params.body, params.data);
  return notification;
}

/** Fan-out push to many users after a bulk in-app notification write. */
export async function sendPushToUsersBestEffort(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown> | null,
) {
  if (userIds.length === 0) return;
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return;

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const stringData = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
      : undefined;

    await messaging.sendEachForMulticast({
      tokens: tokens.map((t: { token: string }) => t.token),
      notification: { title, body },
      data: stringData,
    });
  } catch (err) {
    console.error("[notifications] bulk push send failed:", err);
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, take = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Marks specific notifications (or all unread ones, when `ids` is
 * omitted) as read for the given user. Always scoped by userId so a
 * caller can never mark someone else's notification read. */
export async function markNotificationsRead(
  userId: string,
  ids?: string[],
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ---------- Push (optional, best-effort) ----------
//
// Loaded through a computed dynamic import so the optional `firebase-admin`
// dependency never breaks typecheck/build when it isn't installed — an
// unset FIREBASE_SERVICE_ACCOUNT_JSON (or the package missing) just keeps
// every notification in-app-only instead of failing the write.

let firebaseApp: unknown = null;
let firebaseUnavailable = false;

/** Audit test runs record push in the runner's capture sink instead of FCM. */
function auditCaptureMessaging(sink: string) {
  return {
    async sendEachForMulticast(message: {
      tokens: string[];
      notification: { title: string; body: string };
      data?: Record<string, string>;
    }) {
      captureTransport(sink, {
        kind: "push",
        tokens: message.tokens,
        title: message.notification.title,
        body: message.notification.body,
        ...(message.data ? { data: message.data } : {}),
      });
      return { successCount: message.tokens.length, failureCount: 0, responses: [] };
    },
  };
}

async function getFirebaseMessaging(): Promise<any | null> {
  const sink = auditTransportSink();
  if (sink) return auditCaptureMessaging(sink);
  if (firebaseUnavailable) return null;
  if (firebaseApp) return (firebaseApp as any).messaging();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    firebaseUnavailable = true;
    return null;
  }
  try {
    const moduleName = "firebase-admin";
    const imported: any = await import(moduleName);
    // ESM dynamic import of firebase-admin always exposes `.default`.
    const admin = imported.default;
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return (firebaseApp as any).messaging();
  } catch (err) {
    console.warn(
      "[notifications] firebase-admin unavailable or misconfigured; push disabled:",
      err,
    );
    firebaseUnavailable = true;
    return null;
  }
}

async function sendPushBestEffort(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown> | null,
) {
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return;

    const tokens = await prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const stringData = data
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
      : undefined;

    await messaging.sendEachForMulticast({
      tokens: tokens.map((t: { token: string }) => t.token),
      notification: { title, body },
      data: stringData,
    });
  } catch (err) {
    console.error("[notifications] push send failed:", err);
  }
}
