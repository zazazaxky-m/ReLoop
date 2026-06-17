import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card } from "./Card";
import { cn } from "@/lib/cn";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-foreground">
            {value}
          </p>
          {hint ? <p className="text-xs text-muted-soft">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-lg text-brand-600">
            <Icon />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
