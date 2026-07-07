import { Skeleton } from "@/components/ui";

export default function PrintLoading() {
  return (
    <div
      className="mx-auto max-w-4xl space-y-6 p-8"
      aria-busy="true"
      aria-label="Menyiapkan halaman cetak"
    >
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-4">
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="mx-auto h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
