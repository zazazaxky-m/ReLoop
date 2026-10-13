import { z } from "zod";

import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import {
  hashPassword,
  setSessionCookie,
  verifyPassword,
  buildSessionPayload,
} from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { HttpError, requireApiUser } from "@/lib/rbac";
import { passwordSchema } from "@/lib/password-policy";
import type { AppRole } from "@/lib/roles";
import { userWhereEmail } from "@/lib/encryption";
import { accountEmailSchema } from "@/lib/account-email";
import { lockUser } from "@/lib/db-locks";
import { PENDING_MFA_CLEARED } from "@/lib/mfa";
import { runWalletTransaction } from "@/lib/wallet-service";

/**
 * The only User fields PATCH returns. Never secrets (totpSecret,
 * pendingTotp*), passwordHash, emailLookup or tokenVersion (A02 fix 1, I1).
 */
const PROFILE_SELECT = {
  id: true, name: true, email: true, phone: true, role: true, organizationId: true,
  status: true, payoutEligible: true, createdAt: true, updatedAt: true,
} as const;

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: accountEmailSchema().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: passwordSchema.optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        tokenVersion: true,
      },
    });
    if (dbUser) {
      await setSessionCookie(
        buildSessionPayload({
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role as AppRole,
          organizationId: dbUser.organizationId,
          tokenVersion: dbUser.tokenVersion,
        }),
      );
    }
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
        where: userWhereEmail(normalizedEmail),
        select: { id: true },
      });
      if (existing && existing.id !== user.id) {
        return jsonError(409, "Email sudah digunakan akun lain");
      }
    }

    // Hash before the transaction (CPU only). Under the User lock the
    // password checked above must still be current; a credential change also
    // discards any pending MFA setup (A02).
    const newPasswordHash = changingPassword ? await hashPassword(data.newPassword!) : undefined;
    const updated = await runWalletTransaction(async (tx) => {
      await lockUser(tx, user.id);
      if (changingEmail || changingPassword) {
        const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
        if (current.passwordHash !== user.passwordHash) {
          throw new HttpError(409, "Data akun berubah. Muat ulang lalu coba lagi.");
        }
      }
      return tx.user.update({
        where: { id: user.id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.phone !== undefined
            ? { phone: data.phone?.trim() || null }
            : {}),
          ...(changingEmail
            ? { email: normalizedEmail, tokenVersion: { increment: 1 } }
            : {}),
          ...(changingPassword
            ? { passwordHash: newPasswordHash, tokenVersion: { increment: 1 } }
            : {}),
          ...(changingEmail || changingPassword ? PENDING_MFA_CLEARED : {}),
        },
        select: { ...PROFILE_SELECT, tokenVersion: true },
      });
    });

    await setSessionCookie(buildSessionPayload({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role as AppRole,
      organizationId: updated.organizationId,
      tokenVersion: updated.tokenVersion,
    }));

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

    // Explicit allowlist: only PROFILE_SELECT fields leave, whatever the row holds.
    const { id, name, email, phone, role, organizationId, status, payoutEligible, createdAt, updatedAt } = updated;
    return jsonOk({
      user: { id, name, email, phone, role, organizationId, status, payoutEligible, createdAt, updatedAt },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
