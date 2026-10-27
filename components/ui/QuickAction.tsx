import Link from "next/link";
import { ArrowUpRight } from "./icons";

export function QuickAction({
  href,
  title,
  description,
  index,
}: {
  href: string;
  title: string;
  description: string;
  /** Position in the list, shown as "01", "02", … like the landing's steps. */
  index: number;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-28 flex-col gap-2 rounded-2xl border border-border bg-surface p-3.5 transition-colors hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-4"
    >
      {/* Number and arrow share the top row so the title keeps the full
          width of a two-column tile on a 360px screen. */}
      <span className="flex items-start justify-between gap-2">
        <span className="font-display text-3xl leading-none tracking-[-0.02em] text-muted-soft transition-colors group-hover:text-foreground group-focus-visible:text-foreground">
          {String(index).padStart(2, "0")}
        </span>
        <ArrowUpRight className="shrink-0 text-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
      <span className="min-w-0">
        <span className="block break-words font-bold tracking-[-0.03em] text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted">
          {description}
        </span>
      </span>
    </Link>
  );
}
