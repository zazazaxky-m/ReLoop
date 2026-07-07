import { PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat peta">
      <PageHeaderSkeleton />
      <Skeleton className="h-[60vh] min-h-80 w-full rounded-2xl border border-border" />
    </div>
  );
}
