import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-4 flex flex-col gap-4 border-y border-border bg-surface/75 px-4 py-5 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:-mx-8 lg:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-1 h-10 w-1 shrink-0 rounded-full bg-brand-500" />
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-[28px]">
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 items-center gap-2 [&>*]:flex-1 [&_button]:w-full sm:w-auto sm:[&>*]:flex-none sm:[&_button]:w-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
