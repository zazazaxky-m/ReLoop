import { MetricCardSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat halaman">
      <PageHeaderSkeleton withAction />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-24 rounded-lg border border-border bg-surface"
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-lg border border-border bg-surface lg:col-span-2" />
        <Skeleton className="h-64 rounded-lg border border-border bg-surface" />
      </div>
    </div>
  );
}
