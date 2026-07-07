import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat trash bag">
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={6} columns={4} />
    </div>
  );
}
