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
  return (
    <Card
      data-emphasis={emphasis ? "true" : undefined}
      className={cn(
        "min-h-32 p-4 sm:p-5",
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
              "font-display text-4xl leading-none tracking-[-0.01em] break-words sm:text-[2.75rem]",
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
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg",
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
