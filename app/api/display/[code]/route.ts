import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { buildScanUrl, qrDataUrl, rotateToken } from "@/lib/qr";

// Public endpoint shown on the machine's small screen.
// Rotates the dynamic QR token only when the current one has expired, so the
// token always has a short TTL (the machine's qrRotationSeconds window).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
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

    const scanUrl = buildScanUrl(machine.machineCode, token as string);
    const qr = await qrDataUrl(scanUrl);

    return jsonOk({
      machineCode: machine.machineCode,
      machineName: machine.name,
      status: machine.status,
      rotationSeconds: machine.qrRotationSeconds,
      token,
      expiresAt,
      scanUrl,
      qrDataUrl: qr,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
