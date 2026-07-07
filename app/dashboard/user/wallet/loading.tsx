import { MetricCardSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function WalletLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat dompet">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg border border-border bg-surface lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg border border-border bg-surface" />
      </div>
    </div>
  );
}
