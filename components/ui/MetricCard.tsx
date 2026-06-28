import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card } from "./Card";
import { cn } from "@/lib/cn";

type MetricTone = "green" | "blue" | "amber" | "teal" | "slate";

const toneStyles: Record<
  MetricTone,
  { border: string; icon: string; value: string }
> = {
  green: {
    border: "border-t-brand-500",
    icon: "bg-brand-50 text-brand-700 dark:bg-brand-950/20 dark:text-brand-400",
    value: "text-brand-800 dark:text-brand-400",
  },
  blue: {
    border: "border-t-blue-500",
    icon: "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400",
    value: "text-blue-800 dark:text-blue-400",
  },
  amber: {
    border: "border-t-amber-500",
    icon: "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400",
    value: "text-amber-800 dark:text-amber-400",
  },
  teal: {
    border: "border-t-teal-500",
    icon: "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400",
    value: "text-teal-800 dark:text-teal-400",
  },
  slate: {
    border: "border-t-slate-500",
    icon: "bg-slate-100 text-slate-700 dark:bg-surface-soft dark:text-muted",
    value: "text-slate-800 dark:text-foreground",
  },
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "green",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: MetricTone;
  className?: string;
}) {
  const styles = toneStyles[tone];
  return (
    <Card className={cn("min-h-32 border-t-4 p-4 sm:p-5", styles.border, className)}>
      <div className="flex h-full items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {label}
          </p>
          <p className={cn("break-words text-2xl font-bold leading-tight", styles.value)}>
            {value}
          </p>
          {hint ? <p className="text-xs leading-5 text-muted">{hint}</p> : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg",
              styles.icon,
            )}
          >
            <Icon />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
