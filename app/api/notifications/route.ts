import { z } from "zod";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import {
  getUnreadCount,
  listNotifications,
  markNotificationsRead,
} from "@/lib/notifications";

export async function GET() {
  try {
    const user = await requireApiUser();
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(user.id),
      getUnreadCount(user.id),
    ]);
    return jsonOk({ notifications, unreadCount });
  } catch (error) {
    return handleApiError(error);
  }
}

const patchSchema = z.object({
  // Marks specific notifications read, or every unread one when omitted.
  ids: z.array(z.string()).optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser();
    const body = patchSchema.parse(await req.json());
    const updated = await markNotificationsRead(user.id, body.ids);
    return jsonOk({ updated });
  } catch (error) {
    return handleApiError(error);
  }
}
