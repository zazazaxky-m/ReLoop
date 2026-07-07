import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat tugas">
      <PageHeaderSkeleton withAction />
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
