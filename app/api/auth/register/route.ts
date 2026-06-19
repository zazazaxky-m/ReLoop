import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { dashboardPath } from "@/lib/roles";

const schema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  email: z.string().email("Email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
  phone: z
    .string()
    .trim()
    .min(9, "Nomor HP minimal 9 digit")
    .max(16, "Nomor HP maksimal 16 digit")
    .regex(/^[0-9]+$/, "Nomor HP hanya boleh berisi angka"),
});

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return jsonError(409, "Email sudah terdaftar");

    const user = await prisma.user.create({
      data: {
        name: data.name.trim(),
        email,
        phone: data.phone,
        passwordHash: await hashPassword(data.password),
        role: "USER",
      },
    });

    await setSessionCookie({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: "USER",
      organizationId: null,
    });

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
