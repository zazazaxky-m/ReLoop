import { PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function MapLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat peta">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Skeleton className="h-[60vh] min-h-80 w-full rounded-2xl border border-border" />
        <div className="hidden space-y-3 lg:block">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg border border-border bg-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}
