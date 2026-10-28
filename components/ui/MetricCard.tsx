import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card } from "./Card";
import { cn } from "@/lib/cn";

/** Kept for call-site compatibility; the editorial card is neutral. */
type MetricTone = "green" | "blue" | "amber" | "teal" | "slate";

// Values never wrap: "Rp 12.345.678" is one word (Intl joins "Rp" with a no-break
// space) and a split amount reads as a different one. Short values keep the large
// size; longer ones scale with the card width (cqi), the divisor being the length
// bucket's widest width in em (Anton digits run about 0.46em). Literal classes so
// Tailwind can generate them.
const FIT_BY_LENGTH: [maxLength: number, className: string][] = [
  [4, "text-4xl sm:text-[2.75rem]"],
  [6, "text-[length:min(2.75rem,calc(100cqi/3))]"],
  [8, "text-[length:min(2.75rem,calc(100cqi/3.7))]"],
  [10, "text-[length:min(2.75rem,calc(100cqi/4.6))]"],
  [12, "text-[length:min(2.75rem,calc(100cqi/5.5))]"],
  [14, "text-[length:min(2.75rem,calc(100cqi/6.5))]"],
  [16, "text-[length:min(2.75rem,calc(100cqi/7.4))]"],
];
const FIT_LONGEST = "text-[length:min(2.75rem,calc(100cqi/8.4))]";

function fitValue(value: ReactNode): string {
  const length = typeof value === "string" || typeof value === "number" ? String(value).length : 0;
  return FIT_BY_LENGTH.find(([max]) => length <= max)?.[1] ?? FIT_LONGEST;
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  emphasis = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: MetricTone;
  /** Ink card with a lime value: the one metric on the page that needs action. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <Card
      data-emphasis={emphasis ? "true" : undefined}
      className={cn(
        "@container min-h-32 p-4 sm:p-5",
        emphasis && "border-ink bg-ink text-on-ink dark:border-lime/50",
        className,
      )}
    >
      {/* The icon shares the label row so the value gets the card's full width. */}
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "min-w-0 pt-1 text-xs font-bold uppercase tracking-[0.1em]",
            emphasis ? "text-sidebar-muted" : "text-muted",
          )}
        >
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg",
              emphasis ? "bg-lime text-ink" : "bg-surface-soft text-foreground",
            )}
          >
            <Icon />
          </span>
        ) : null}
      </div>
      <p
        data-metric-value=""
        className={cn(
          "mt-2 whitespace-nowrap font-display leading-none tracking-[-0.01em]",
          fitValue(value),
          emphasis ? "text-lime" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className={cn("mt-2 text-xs leading-5", emphasis ? "text-sidebar-muted" : "text-muted")}>
          {hint}
        </p>
      ) : null}
    </Card>
  );
}
