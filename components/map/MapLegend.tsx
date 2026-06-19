const ITEMS: { label: string; color: string }[] = [
  { label: "Online", color: "#16a34a" },
  { label: "Penuh", color: "#d97706" },
  { label: "Maintenance", color: "#2563eb" },
  { label: "Error", color: "#dc2626" },
  { label: "Offline", color: "#64748b" },
];

export function MapLegend({ showCampaign = true }: { showCampaign?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {ITEMS.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: i.color }}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
      {showCampaign ? (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] text-white"
            style={{ background: "#0d9488" }}
            aria-hidden
          >
            ★
          </span>
          Program
        </span>
      ) : null}
    </div>
  );
}
