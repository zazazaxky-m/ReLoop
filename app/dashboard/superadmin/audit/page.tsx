import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { PageHeader, Card, CardContent, Badge, buttonVariants } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit Log" };

const ENTITY_FILTERS = [
  "Machine",
  "DepositSession",
  "OrganizationCollectorPartner",
  "PickupRequest",
  "Redemption",
  "Campaign",
  "WasteType",
  "Trip",
];

export default async function SuperadminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const { entity } = await searchParams;

  const where: Prisma.AuditLogWhereInput = entity ? { entityType: entity } : {};
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 150,
  });

  const actorIds = Array.from(
    new Set(logs.map((l) => l.actorId).filter((x): x is string => Boolean(x))),
  );
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, role: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Riwayat aksi sensitif lintas platform (maks 150 terbaru)."
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/dashboard/superadmin/audit"
          className={buttonVariants({ variant: entity ? "outline" : "primary", size: "sm" })}
        >
          Semua
        </Link>
        {ENTITY_FILTERS.map((e) => (
          <Link
            key={e}
            href={`/dashboard/superadmin/audit?entity=${e}`}
            className={buttonVariants({ variant: entity === e ? "primary" : "outline", size: "sm" })}
          >
            {e}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">Belum ada log.</p>
          ) : (
            <ul className="divide-y divide-border">
              {logs.map((l) => {
                const actor = l.actorId ? actorById.get(l.actorId) : null;
                return (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-foreground">
                        <Badge tone="brand">{l.action}</Badge>
                        <span className="text-muted">{l.entityType}</span>
                      </p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {actor ? `${actor.name} (${actor.role})` : "Sistem"}
                        {l.entityId ? ` · ${l.entityId}` : ""}
                      </p>
                    </div>
                    <span className={cn("shrink-0 text-xs text-muted-soft")}>
                      {formatDateTime(l.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
