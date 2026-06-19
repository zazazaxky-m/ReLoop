import { z } from "zod";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { CONFIG_KEYS, getAllConfig, setConfig } from "@/lib/config";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  [CONFIG_KEYS.MIN_REDEMPTION]: z.number().int().min(0).max(100_000_000).optional(),
  [CONFIG_KEYS.DEFAULT_QR_ROTATION_SECONDS]: z.number().int().min(10).max(3600).optional(),
  [CONFIG_KEYS.POINTS_TO_RUPIAH]: z.number().int().min(1).max(1_000_000).optional(),
  [CONFIG_KEYS.LANDING_HERO_SLIDES]: z.string().max(20_000).optional(),
});

export async function GET() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const config = await getAllConfig();
    return jsonOk({ config });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const data = patchSchema.parse(await req.json());

    const updated: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      await setConfig(key, String(value));
      updated[key] = String(value);
    }

    await logAudit({
      actorId: user.id,
      action: "CONFIG_UPDATE",
      entityType: "SystemConfig",
      metadata: updated,
    });

    const config = await getAllConfig();
    return jsonOk({ config, updated });
  } catch (error) {
    return handleApiError(error);
  }
}
