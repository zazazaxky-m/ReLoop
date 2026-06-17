import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { organizationOptions } from "@/lib/queries";
import { UserManager, type UserRow } from "@/components/admin/UserManager";

export const metadata: Metadata = { title: "Pengguna" };

export default async function SuperadminUsersPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        organizationId: true,
        organization: { select: { name: true } },
      },
    }),
    organizationOptions(),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    organizationId: u.organizationId,
    organizationName: u.organization?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Pengguna & Peran" description="Kelola akun, peran, dan status seluruh pengguna platform." />
      <UserManager users={rows} organizations={organizations} />
    </div>
  );
}
