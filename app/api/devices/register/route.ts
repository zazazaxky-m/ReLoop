import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

const schema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["android", "ios"]),
});

/** Called by the mobile app after login (see
 * mobile/lib/services/notification_service.dart) so push notifications
 * have somewhere to be sent. Upsert by token: re-registering the same
 * token under a different user (device shared/re-logged-in) reassigns it
 * instead of erroring. */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    const data = schema.parse(await req.json());

    await prisma.deviceToken.upsert({
      where: { token: data.token },
      update: { userId: user.id, platform: data.platform },
      create: { userId: user.id, token: data.token, platform: data.platform },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
