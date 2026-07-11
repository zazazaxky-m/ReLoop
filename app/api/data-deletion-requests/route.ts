import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

const ALLOWED_TYPES = [
  "profile",
  "payout",
  "deposits",
  "redemptions",
  "travel",
  "notifications",
  "reports",
] as const;

const schema = z.object({
  email: z.string().email("Email tidak valid"),
  reason: z.string().max(2000).optional().or(z.literal("")),
  dataTypes: z
    .array(z.enum(ALLOWED_TYPES))
    .min(1, "Pilih minimal satu kategori data"),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3600_000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const rl = await checkRateLimit(
      `data-deletion:${ip}`,
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
    const dataTypes = parsed.data.dataTypes as unknown as string[];

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    const request = await prisma.deletionRequest.create({
      data: {
        email,
        userId: user?.id ?? null,
        scope: "PARTIAL",
        dataTypes,
        reason,
        ipAddress: ip,
        userAgent: userAgent ?? null,
      },
    });

    await logAudit({
      actorId: user?.id ?? null,
      action: "DATA_DELETION_REQUESTED",
      entityType: "DeletionRequest",
      entityId: request.id,
      metadata: { email, ip, dataTypes },
    });

    return jsonOk({
      message:
        "Permintaan penghapusan sebagian data diterima. Kami akan menghubungi Anda untuk verifikasi.",
      requestId: request.id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
