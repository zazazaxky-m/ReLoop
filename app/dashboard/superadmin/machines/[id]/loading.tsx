import {
  MetricCardSkeleton,
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat detail mesin">
      <PageHeaderSkeleton withAction />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-lg border border-border bg-surface" />
        <Skeleton className="h-56 rounded-lg border border-border bg-surface" />
      </div>
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
