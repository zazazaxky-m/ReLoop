import { PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat profil">
      <PageHeaderSkeleton />
      <div className="rounded-lg border border-border bg-surface shadow-sm">
        <div className="border-b border-border bg-surface-soft/60 px-5 py-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-64 max-w-[80vw]" />
          ))}
        </div>
      </div>
    </div>
  );
}
