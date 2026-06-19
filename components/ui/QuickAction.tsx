import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/cn";
import { ArrowUpRight } from "./icons";

type QuickActionTone = "green" | "blue" | "amber" | "teal";

const toneStyles: Record<
  QuickActionTone,
  { surface: string; icon: string; arrow: string }
> = {
  green: {
    surface: "border-brand-200 bg-brand-50/70 hover:border-brand-300",
    icon: "bg-brand-600 text-white",
    arrow: "text-brand-700",
  },
  blue: {
    surface: "border-blue-200 bg-blue-50/70 hover:border-blue-300",
    icon: "bg-blue-600 text-white",
    arrow: "text-blue-700",
  },
  amber: {
    surface: "border-amber-200 bg-amber-50/70 hover:border-amber-300",
    icon: "bg-amber-500 text-white",
    arrow: "text-amber-700",
  },
  teal: {
    surface: "border-teal-200 bg-teal-50/70 hover:border-teal-300",
    icon: "bg-teal-600 text-white",
    arrow: "text-teal-700",
  },
};

export function QuickAction({
  href,
  title,
  description,
  icon: Icon,
  tone = "green",
}: {
  href: string;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: QuickActionTone;
}) {
  const styles = toneStyles[tone];
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-28 items-start gap-3 rounded-lg border p-3.5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md sm:p-4",
        styles.surface,
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg shadow-sm",
          styles.icon,
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="font-bold text-foreground">{title}</span>
          <ArrowUpRight
            className={cn(
              "mt-0.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
              styles.arrow,
            )}
          />
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted">
          {description}
        </span>
      </span>
    </Link>
  );
}
