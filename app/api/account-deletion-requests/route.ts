import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { userWhereEmail } from "@/lib/encryption";

const schema = z.object({
  email: z.string().email("Email tidak valid"),
  reason: z.string().max(2000).optional().or(z.literal("")),
});

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 3600_000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const rl = await checkRateLimit(
      `account-deletion:${ip}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(
        429,
        "Terlalu banyak permintaan. Coba lagi dalam 1 jam.",
      );
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonError(422, "Validasi gagal", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const reason = parsed.data.reason?.trim() || null;

    // Best-effort link to an existing user, but always accept the request even
    // if the email isn't on file (so the endpoint can't be used to enumerate
    // which emails are registered).
    const user = await prisma.user.findUnique({
      where: userWhereEmail(email),
      select: { id: true, status: true },
    });

    const request = await prisma.deletionRequest.create({
      data: {
        email,
        userId: user?.id ?? null,
        scope: "FULL",
        reason,
        ipAddress: ip,
        userAgent: userAgent ?? null,
      },
    });

    await logAudit({
      actorId: user?.id ?? null,
      action: "ACCOUNT_DELETION_REQUESTED",
      entityType: "DeletionRequest",
      entityId: request.id,
      metadata: { email, ip, scope: "FULL" },
    });

    return jsonOk({
      message:
        "Permintaan penghapusan akun diterima. Tim kami akan menghubungi Anda untuk verifikasi.",
      requestId: request.id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
