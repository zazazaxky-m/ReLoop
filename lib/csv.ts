type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Builds CSV text (with header row) from an array of objects. */
export function toCsv<T extends Record<string, CsvCell>>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows
    .map((row) => columns.map((c) => escapeCell(row[c.key])).join(","))
    .join("\r\n");
  return body ? `${header}\r\n${body}` : header;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
