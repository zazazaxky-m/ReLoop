import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  PagePagination,
  StatusBadge,
} from "@/components/ui";
import { Trash } from "@/components/ui/icons";
import { formatDate, formatRupiah } from "@/lib/format";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { getInvitedTravelAgentTripFilters } from "@/lib/trip";

function stageLabel(stage: string) {
  switch (stage) {
    case "CHECK_IN":
      return "Check-in";
    case "CHECK_OUT":
      return "Check-out";
    case "BANK_SAMPAH_PICKUP":
      return "Pickup bank sampah";
    default:
      return stage;
  }
}

export default async function UserTrashBagPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["USER"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params, { defaultLimit: 20, maxLimit: 50 });

  const invitedAgentOrgs = await getInvitedTravelAgentTripFilters(user.id);

  const tripWhere = {
    OR: [
      { userId: user.id },
      ...invitedAgentOrgs.map((link) => ({
        travelAgentId: link.travelAgentId,
        campaign: { organizationId: link.organizationId },
      })),
    ],
  };

  const [trips, total] = await Promise.all([
    prisma.trip.findMany({
      where: tripWhere,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        campaign: { select: { name: true, rewardMode: true } },
        travelAgent: { select: { name: true } },
        bagAssignments: {
          orderBy: { assignedAt: "asc" },
          take: 200,
          include: { wasteType: { select: { name: true } } },
        },
        validations: { orderBy: { createdAt: "desc" }, take: 20 },
        _count: { select: { bagAssignments: true } },
      },
    }),
    prisma.trip.count({ where: tripWhere }),
  ]);

  const tripIds = trips.map((t) => t.id);
  const validationIds = trips.flatMap((t) => t.validations.map((v) => v.id));
  const rewardRows =
    tripIds.length === 0
      ? []
      : await prisma.rewardLedger.findMany({
          where: {
            reasonCode: "TRASH_BAG_RETURN",
            OR: [
              { referenceType: "Trip", referenceId: { in: tripIds } },
              ...(validationIds.length
                ? [{ referenceType: "ManualValidation", referenceId: { in: validationIds } }]
                : []),
            ],
          },
          select: { amount: true, referenceType: true, referenceId: true, campaignId: true },
        });

  const rewardByTripId = new Map<string, number>();
  for (const trip of trips) {
    let sum = 0;
    for (const row of rewardRows) {
      if (row.referenceType === "Trip" && row.referenceId === trip.id) {
        sum += row.amount;
      } else if (
        row.referenceType === "ManualValidation" &&
        trip.validations.some((v) => v.id === row.referenceId)
      ) {
        sum += row.amount;
      }
    }
    rewardByTripId.set(trip.id, sum);
  }

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trash Bag / Trip"
        description="Lihat penugasan kantong, status pengembalian, reward, dan hasil validasi."
      />

      {trips.length === 0 ? (
        <EmptyState
          icon={Trash}
          title="Belum ada trip"
          description="Belum ada penugasan kantong atau perjalanan untuk akun Anda."
        />
      ) : (
        trips.map((t) => {
          const rewardAmount = rewardByTripId.get(t.id) ?? 0;
          const pickedUp = t.validations.some((v) => v.validationStage === "BANK_SAMPAH_PICKUP");
          const bagTotal = t._count.bagAssignments;
          const bagShown = t.bagAssignments.length;
          return (
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
                  {pickedUp ? <StatusBadge status="BANK_SAMPAH_PICKUP" /> : null}
                  {t.campaign.rewardMode === "MONEY_REWARD" ? (
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      Reward {formatRupiah(rewardAmount)}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-mint/40 dark:bg-brand-950/20 px-3 py-2">
                    <p className="font-semibold text-brand-800 dark:text-brand-400">
                      Trash bag ({bagShown}
                      {bagTotal > bagShown ? ` dari ${bagTotal}` : ""})
                    </p>
                    {t.bagAssignments.length ? (
                      <ul className="mt-1 space-y-2 text-xs text-muted">
                        {t.bagAssignments.map((b) => (
                          <li key={b.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">{b.bagQrCode}</span>
                            <span>- {b.wasteType?.name ?? "Campuran"}</span>
                            {b.status ? (
                              <StatusBadge status={b.status} />
                            ) : (
                              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                Belum divalidasi
                              </span>
                            )}
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
                            {formatDate(v.createdAt)} - {stageLabel(v.validationStage)} -{" "}
                            {v.returnedBagCount ?? 0} tas - {v.conditionStatus ?? "-"}
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
          );
        })
      )}

      <PagePagination
        basePath="/dashboard/user/trash-bag"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
