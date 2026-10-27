import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small lime tag above the title, e.g. today's date on a dashboard home. */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-1 pt-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow ? (
          <p className="inline-block rounded-[3px] bg-lime -rotate-[1.5deg] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-bold leading-[1.04] tracking-[-0.06em] text-foreground sm:text-[2.75rem]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-6 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 items-center gap-2 [&>*]:flex-1 [&_button]:w-full sm:w-auto sm:[&>*]:flex-none sm:[&_button]:w-auto">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
