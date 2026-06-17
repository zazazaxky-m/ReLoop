import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";

const dotTone: Record<Tone, string> = {
  success: "bg-brand-500",
  warning: "bg-amber-500",
  danger: "bg-status-error",
  info: "bg-blue-500",
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
};

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp?: ReactNode;
  tone?: Tone;
}

export function Timeline({
  items,
  className,
}: {
  items: TimelineItem[];
  className?: string;
}) {
  return (
    <ol className={cn("relative space-y-5 pl-6", className)}>
      <span className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-border" />
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            className={cn(
              "absolute -left-[22px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-surface",
              dotTone[item.tone ?? "neutral"],
            )}
          />
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {item.title}
              </p>
              {item.timestamp ? (
                <span className="text-xs text-muted-soft">
                  {item.timestamp}
                </span>
              ) : null}
            </div>
            {item.description ? (
              <p className="text-sm text-muted">{item.description}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
