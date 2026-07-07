import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildScanUrl, qrDataUrl, rotateToken } from "@/lib/qr";

export const dynamic = "force-dynamic";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

// Public endpoint shown on the machine's small screen.
// Rotates the dynamic QR token only when the current one has expired, so the
// token always has a short TTL (the machine's qrRotationSeconds window).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const ip = getClientIp(req);
    const rl = await checkRateLimit(
      `display:${ip}:${code.toUpperCase()}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak permintaan. Coba lagi nanti.");
    }

    const machine = await prisma.machine.findUnique({
      where: { machineCode: code },
    });
    if (!machine) return jsonError(404, "Mesin tidak ditemukan");

    let token = machine.qrToken;
    let expiresAt = machine.qrTokenExpiresAt;
    const expired = !token || !expiresAt || expiresAt.getTime() <= Date.now();
    if (expired) {
      const rotated = await rotateToken(machine.id, machine.qrRotationSeconds);
      token = rotated.token;
      expiresAt = rotated.expiresAt;
    }

    if (!token) return jsonError(500, "Token QR gagal dibuat");

    const scanUrl = buildScanUrl(machine.machineCode, token);
    const qr = await qrDataUrl(scanUrl);

    return jsonOk({
      machineCode: machine.machineCode,
      machineName: machine.name,
      status: machine.status,
      rotationSeconds: machine.qrRotationSeconds,
      expiresAt,
      scanUrl,
      qrDataUrl: qr,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
