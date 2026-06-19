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
        "-mx-4 overflow-hidden border-y border-border bg-surface shadow-sm sm:mx-0 sm:rounded-lg sm:border",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead className="bg-slate-100/80">
            <tr className="border-b border-border bg-slate-50/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted",
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
                className="border-b border-border last:border-0 transition-colors hover:bg-brand-50/50"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3.5 align-middle text-foreground",
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
    </div>
  );
}
