import { z } from "zod";

import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import {
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email("Email tidak valid").optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6, "Password minimal 6 karakter").optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const sessionUser = await requireApiUser();
    const data = patchSchema.parse(await req.json());
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
    });

    if (!user) return jsonError(404, "Pengguna tidak ditemukan");

    const normalizedEmail = data.email?.toLowerCase().trim();
    const changingEmail =
      normalizedEmail !== undefined && normalizedEmail !== user.email;
    const changingPassword = data.newPassword !== undefined;

    if (changingEmail || changingPassword) {
      const valid =
        Boolean(user.passwordHash) &&
        (await verifyPassword(data.currentPassword ?? "", user.passwordHash!));
      if (!valid) return jsonError(401, "Password saat ini tidak sesuai");
    }

    if (changingEmail) {
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existing && existing.id !== user.id) {
        return jsonError(409, "Email sudah digunakan akun lain");
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.phone !== undefined
          ? { phone: data.phone?.trim() || null }
          : {}),
        ...(changingEmail ? { email: normalizedEmail } : {}),
        ...(changingPassword
          ? { passwordHash: await hashPassword(data.newPassword!) }
          : {}),
      },
    });

    await setSessionCookie({
      sub: updated.id,
    email: updated.email,
    name: updated.name,
      role: updated.role as AppRole,
      organizationId: updated.organizationId,
    });

    await logAudit({
      actorId: updated.id,
      action: changingPassword
        ? "PROFILE_AND_PASSWORD_UPDATE"
        : "PROFILE_UPDATE",
      entityType: "User",
      entityId: updated.id,
      metadata: {
        emailChanged: changingEmail,
        passwordChanged: changingPassword,
      },
    });

    const { passwordHash: _, ...safeUser } = updated;
    return jsonOk({ user: safeUser });
  } catch (error) {
    return handleApiError(error);
  }
}
