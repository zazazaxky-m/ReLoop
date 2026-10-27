import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card } from "./Card";
import { cn } from "@/lib/cn";

/** Kept for call-site compatibility; the editorial card is neutral. */
type MetricTone = "green" | "blue" | "amber" | "teal" | "slate";

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
  // A formatted amount such as "Rp 12.345.678" cannot wrap (Intl joins "Rp" with
  // a no-break space): in a narrow card it drops a size and the icon makes room.
  const long = typeof value === "string" && value.length > 8;
  return (
    <Card
      data-emphasis={emphasis ? "true" : undefined}
      className={cn(
        "@container min-h-32 p-4 sm:p-5",
        emphasis && "border-ink bg-ink text-on-ink dark:border-lime/50",
        className,
      )}
    >
      <div className="flex h-full items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p
            className={cn(
              "text-xs font-bold uppercase tracking-[0.1em]",
              emphasis ? "text-sidebar-muted" : "text-muted",
            )}
          >
            {label}
          </p>
          <p
            className={cn(
              "font-display leading-none tracking-[-0.01em] break-words",
              long ? "text-xl @[13rem]:text-4xl @[17rem]:text-[2.75rem]" : "text-4xl sm:text-[2.75rem]",
              emphasis ? "text-lime" : "text-foreground",
            )}
          >
            {value}
          </p>
          {hint ? (
            <p className={cn("text-xs leading-5", emphasis ? "text-sidebar-muted" : "text-muted")}>
              {hint}
            </p>
          ) : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg",
              long ? "hidden @[13rem]:flex" : "flex",
              emphasis ? "bg-lime text-ink" : "bg-surface-soft text-foreground",
            )}
          >
            <Icon />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
