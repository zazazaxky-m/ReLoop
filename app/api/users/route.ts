import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { displayUsers } from "@/lib/display-user";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";
import { passwordSchema } from "@/lib/password-policy";

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: passwordSchema.max(100),
  role: z.enum(["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"]),
  organizationId: z.string().nullable().optional(),
  phone: z.string().max(40).optional(),
});

export async function GET(req: Request) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const url = new URL(req.url);
    const roleFilter = url.searchParams.get("role") ?? undefined;

    const pagination = parsePagination(url);

    const where: Prisma.UserWhereInput = {};
    if (roleFilter) where.role = roleFilter as Prisma.EnumRoleFilter["equals"];

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          organizationId: true,
          organization: { select: { name: true } },
          createdAt: true,
        },
      }),
    ]);
    return jsonOk({
      users: displayUsers(users),
      pagination: buildPaginationMeta(total, pagination),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireApiUser(["SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) return jsonError(409, "Email sudah terdaftar");

    if (data.role === "ADMIN" && !data.organizationId) {
      return jsonError(422, "Admin wajib terhubung ke organisasi");
    }

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        phone: data.phone ?? null,
        passwordHash: await hashPassword(data.password),
        role: data.role,
        organizationId: data.role === "ADMIN" ? data.organizationId : (data.organizationId ?? null),
        status: "ACTIVE",
      },
    });

    await logAudit({
      actorId: actor.id,
      action: "USER_CREATE",
      entityType: "User",
      entityId: user.id,
      metadata: { role: user.role, email: user.email },
    });

    return jsonOk({ user: { id: user.id, email: user.email, role: user.role } }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
