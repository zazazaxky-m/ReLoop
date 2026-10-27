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
        "flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-rule-strong bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-700 dark:text-brand-400">
          <Icon />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-bold tracking-[-0.03em] text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
