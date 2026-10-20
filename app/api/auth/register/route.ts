import { after, NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie, buildSessionPayload } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { dashboardPath } from "@/lib/roles";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/password-policy";
import { emailLookupHash, userWhereEmail } from "@/lib/encryption";
import { deliverEmailOutboxSafely, enqueueEmailVerification } from "@/lib/email-outbox";
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

    // A03: registering with an address proves nothing about its mailbox, so no
    // invitation is claimed here. The account gets a verification mail; an
    // invitation is accepted only with the token emailed to the invited address
    // (POST /api/travel-agent-invitations/accept).
    const passwordHash = await hashPassword(data.password);
    const { user, outboxId } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: data.name.trim(),
          email,
          phone: data.phone,
          passwordHash,
          role: "USER",
        },
      });
      const queued = await enqueueEmailVerification(tx, created.id, emailLookupHash(email));
      return { user: created, outboxId: queued };
    });
    // Delivered after the response; scripts/process-email-outbox.ts retries.
    after(() => deliverEmailOutboxSafely(outboxId));

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
      user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: false },
      redirectTo: dashboardPath("USER"),
      emailVerificationQueued: true,
    }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
