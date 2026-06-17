import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl text-brand-500">
          <Icon />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
