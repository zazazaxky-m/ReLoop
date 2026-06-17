import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}

export function buildScanUrl(machineCode: string, token: string): string {
  const u = new URL("/scan", baseUrl());
  u.searchParams.set("m", machineCode);
  u.searchParams.set("t", token);
  return u.toString();
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 320,
    margin: 1,
    color: { dark: "#14532d", light: "#ffffff" },
  });
}

export function isTokenValid(
  machine: { qrToken: string | null; qrTokenExpiresAt: Date | null },
  token: string,
): boolean {
  if (!machine.qrToken || !machine.qrTokenExpiresAt) return false;
  if (machine.qrToken !== token) return false;
  return machine.qrTokenExpiresAt.getTime() > Date.now();
}

/** Issues a fresh token for the machine with a short TTL (rotation window). */
export async function rotateToken(machineId: string, rotationSeconds: number) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + Math.max(5, rotationSeconds) * 1000);
  await prisma.machine.update({
    where: { id: machineId },
    data: { qrToken: token, qrTokenExpiresAt: expiresAt },
  });
  return { token, expiresAt };
}
