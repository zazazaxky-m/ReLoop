import { cn } from "@/lib/cn";

/**
 * Machine fill-level track. The fill is an SVG rect so the dynamic width is an
 * attribute rather than an inline style, which our CSP blocks in production.
 */
export function FillLevelBar({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  const width = Math.max(0, Math.min(percent, 100));
  return (
    <div className={cn("h-2 flex-1 overflow-hidden rounded-full bg-border", className)}>
      <svg
        className="block h-full w-full"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        <rect
          width={width}
          height={1}
          className={percent >= 80 ? "fill-amber-500" : "fill-ink dark:fill-lime"}
        />
      </svg>
    </div>
  );
}
