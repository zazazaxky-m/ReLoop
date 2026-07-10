"use client";

import { useRouter } from "next/navigation";

type PrintLayout = "sticker" | "sheet";

export function PrintControls({
  tripId,
  layout,
}: {
  tripId: string;
  layout: PrintLayout;
}) {
  const router = useRouter();

  function switchLayout(next: PrintLayout) {
    if (next === layout) return;
    router.replace(`/print/trips/${tripId}?layout=${next}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-1 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => switchLayout("sticker")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            layout === "sticker"
              ? "bg-white text-emerald-800 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Stiker A4
        </button>
        <button
          type="button"
          onClick={() => switchLayout("sheet")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            layout === "sheet"
              ? "bg-white text-emerald-800 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Lembar Kartu
        </button>
      </div>

      <button
        type="button"
        onClick={() => window.close()}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Tutup
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
      >
        Cetak Sekarang
      </button>
    </div>
  );
}
