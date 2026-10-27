// Static color classes (not inline styles, which our CSP blocks); keep in sync
// with the .rl-status--* colors in map-markers.css.
const ITEMS: { label: string; dotClass: string }[] = [
  { label: "Online", dotClass: "bg-status-online" },
  { label: "Penuh", dotClass: "bg-status-full" },
  { label: "Maintenance", dotClass: "bg-status-maintenance" },
  { label: "Error", dotClass: "bg-status-error" },
  { label: "Offline", dotClass: "bg-status-offline" },
];

export function MapLegend({ showCampaign = true }: { showCampaign?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      {ITEMS.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 rounded-full ${i.dotClass}`}
            aria-hidden
          />
          {i.label}
        </span>
      ))}
      {showCampaign ? (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink text-[8px] text-lime ring-1 ring-on-ink"
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
