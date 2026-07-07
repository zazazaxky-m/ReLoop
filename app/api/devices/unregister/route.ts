import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

const schema = z.object({
  token: z.string().min(10).max(500),
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    const data = schema.parse(await req.json());

    await prisma.deviceToken.deleteMany({
      where: { token: data.token, userId: user.id },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
