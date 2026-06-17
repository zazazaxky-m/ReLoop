export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(d);
}

export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec} detik lalu`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  return `${day} hari lalu`;
}
