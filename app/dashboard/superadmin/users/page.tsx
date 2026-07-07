import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { organizationOptions } from "@/lib/queries";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { UserManager, type UserRow } from "@/components/admin/UserManager";

export const metadata: Metadata = { title: "Pengguna & Peran" };

export default async function SuperadminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const [users, total, organizations] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
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
    prisma.user.count(),
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

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengguna & Peran"
        description="Kelola akun, peran, organisasi, dan status akses pengguna."
      />
      <UserManager users={rows} organizations={organizations} />
      <PagePagination
        basePath="/dashboard/superadmin/users"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
