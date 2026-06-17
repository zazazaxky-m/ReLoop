import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

const alignClass = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyTitle = "Belum ada data",
  emptyDescription,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  className?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm",
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-slate-50/80">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted",
                  alignClass[col.align ?? "left"],
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              className="border-b border-border last:border-0 transition-colors hover:bg-brand-50/40"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-3 align-middle text-foreground",
                    alignClass[col.align ?? "left"],
                    col.className,
                  )}
                >
                  {col.render
                    ? col.render(row)
                    : ((row as Record<string, ReactNode>)[col.key] ?? "-")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
