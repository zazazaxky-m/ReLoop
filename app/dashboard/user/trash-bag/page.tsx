import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { Trash } from "@/components/ui/icons";
import { formatDate } from "@/lib/format";

export default async function UserTrashBagPage() {
  const user = await requirePageUser(["USER"]);

  const agentLinks = await prisma.travelAgentUser.findMany({
    where: { userId: user.id },
    select: { travelAgentId: true },
  });
  const travelAgentIds = agentLinks.map((link) => link.travelAgentId);

  const trips = await prisma.trip.findMany({
    where: {
      OR: [
        { userId: user.id },
        travelAgentIds.length ? { travelAgentId: { in: travelAgentIds } } : { id: "__none__" },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      campaign: { select: { name: true, rewardMode: true } },
      travelAgent: { select: { name: true } },
      bagAssignments: {
        orderBy: { assignedAt: "desc" },
        include: { wasteType: { select: { name: true } } },
      },
      validations: { orderBy: { createdAt: "desc" } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trash Bag / Trip"
        description="Lihat penugasan kantong, status pengembalian, dan hasil validasi."
      />

      {trips.length === 0 ? (
        <EmptyState
          icon={Trash}
          title="Belum ada trip"
          description="Belum ada penugasan kantong atau perjalanan untuk akun Anda."
        />
      ) : (
        trips.map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t.groupName ?? t.campaign.name}</CardTitle>
              <StatusBadge status={t.complianceStatus} />
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted">
                {t.travelAgent?.name ?? t.travelAgentName ?? t.campaign.name}
                {t.leaderName ? ` - ${t.leaderName}` : ""} - {t.participantCount} peserta
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={t.status} />
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  Skor {t.complianceScore}/100
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-mint/40 dark:bg-brand-950/20 px-3 py-2">
                  <p className="font-semibold text-brand-800 dark:text-brand-400">Trash bag ({t.bagAssignments.length})</p>
                  {t.bagAssignments.length ? (
                    <ul className="mt-1 space-y-1 font-mono text-xs text-muted">
                      {t.bagAssignments.map((b) => (
                        <li key={b.id}>
                          {b.bagQrCode} - {b.wasteType?.name ?? "Campuran"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Belum ada tas</p>
                  )}
                </div>
                <div className="rounded-xl bg-surface-soft px-3 py-2">
                  <p className="font-semibold text-foreground">Validasi ({t.validations.length})</p>
                  {t.validations.length ? (
                    <ul className="mt-1 space-y-1 text-xs text-muted">
                      {t.validations.map((v) => (
                        <li key={v.id}>
                          {formatDate(v.createdAt)} - {v.validationStage} - {v.returnedBagCount ?? 0} tas -{" "}
                          {v.conditionStatus ?? "-"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Belum ada validasi</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
