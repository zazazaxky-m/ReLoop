import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie, buildSessionPayload } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { dashboardPath } from "@/lib/roles";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/password-policy";
import { userWhereEmail } from "@/lib/encryption";
import { accountEmailSchema } from "@/lib/account-email";

// Looser than login (legitimate signups are rare per visitor) but still
// closes the previously wide-open account-creation endpoint.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 3_600_000;

const schema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: accountEmailSchema(),
  password: passwordSchema,
  phone: z
    .string()
    .trim()
    .min(9, "Nomor HP minimal 9 digit")
    .max(16, "Nomor HP maksimal 16 digit")
    .regex(/^[0-9]+$/, "Nomor HP hanya boleh berisi angka"),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(`register:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan registrasi. Coba lagi nanti.");
    }

    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: userWhereEmail(email) });
    if (existing) return jsonError(409, "Email sudah terdaftar");

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: data.name.trim(),
          email,
          phone: data.phone,
          passwordHash: await hashPassword(data.password),
          role: "USER",
        },
      });

      const pendingInvites = await tx.travelAgentInvite.findMany({
        where: { email, status: "PENDING", travelAgentId: { not: null } },
        select: { travelAgentId: true, organizationId: true },
      });

      for (const invite of pendingInvites) {
        const travelAgentId = invite.travelAgentId as string;
        await tx.travelAgentUser.upsert({
          where: {
            travelAgentId_userId: {
              travelAgentId,
              userId: created.id,
            },
          },
          update: { roleInAgent: "OWNER" },
          create: {
            travelAgentId,
            userId: created.id,
            roleInAgent: "OWNER",
          },
        });
        await tx.travelAgentOrganization.updateMany({
          where: {
            travelAgentId,
            organizationId: invite.organizationId,
            status: "PENDING",
          },
          data: { status: "INVITED", approvedAt: new Date() },
        });
      }

      if (pendingInvites.length) {
        await tx.travelAgentInvite.updateMany({
          where: { email, status: "PENDING" },
          data: { status: "INVITED" },
        });
      }

      return created;
    });

    await setSessionCookie(buildSessionPayload({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "USER",
      organizationId: null,
      tokenVersion: user.tokenVersion,
    }));

    await logAudit({
      actorId: user.id,
      action: "USER_REGISTER",
      entityType: "User",
      entityId: user.id,
    });

    return jsonOk({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      redirectTo: dashboardPath("USER"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
