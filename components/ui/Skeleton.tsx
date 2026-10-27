import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-surface-soft", className)}
      {...props}
    />
  );
}

export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "min-h-32 rounded-lg border border-t-4 border-border border-t-border bg-surface p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
      </div>
    </div>
  );
}

export function PageHeaderSkeleton({
  withAction = false,
}: {
  withAction?: boolean;
}) {
  return (
    <div className="-mx-4 flex flex-col gap-4 border-y border-border bg-surface/75 px-4 py-5 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1 h-10 w-1 shrink-0 rounded-full bg-border" />
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-6 w-52 max-w-[60vw]" />
          <Skeleton className="h-4 w-72 max-w-[80vw]" />
        </div>
      </div>
      {withAction ? <Skeleton className="h-10 w-full rounded-lg sm:w-32" /> : null}
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "-mx-4 overflow-hidden border-y border-border bg-surface sm:mx-0 sm:rounded-2xl sm:border",
        className,
      )}
    >
      <div className="flex items-center gap-4 border-b border-rule-strong px-4 py-3.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-0"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-4 flex-1", c === 0 ? "max-w-[40%]" : "")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
