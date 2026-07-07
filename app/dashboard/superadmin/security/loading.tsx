import { MetricCardSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat log keamanan">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
