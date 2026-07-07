export default function ScanLoading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4"
      aria-busy="true"
      aria-label="Memuat pemindai"
    >
      <div className="h-7 w-40 animate-pulse rounded-md bg-surface-soft" />
      <div className="aspect-square w-full animate-pulse rounded-2xl border border-border bg-surface-soft" />
      <div className="h-4 w-full animate-pulse rounded-md bg-surface-soft" />
      <div className="h-4 w-2/3 animate-pulse rounded-md bg-surface-soft" />
    </div>
  );
}
