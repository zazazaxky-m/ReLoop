import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Tone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "brand";

export const toneClasses: Record<Tone, string> = {
  success: "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/20 dark:text-status-online dark:border-brand-900/30",
  warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30",
  danger: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30",
  info: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/30",
  neutral: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-surface-soft dark:text-muted dark:border-border",
  brand: "bg-brand-100 text-brand-700 border-brand-300 dark:bg-brand-950/30 dark:text-status-online dark:border-brand-900/40",
};

// A badge is a label in the app face wherever it sits, including inside an
// Anton metric value with its tight tracking.
export const badgeBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-sans text-xs font-bold tracking-normal";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeBase,
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
