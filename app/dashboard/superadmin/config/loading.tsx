import { PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat konfigurasi">
      <PageHeaderSkeleton />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-sm"
        >
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
