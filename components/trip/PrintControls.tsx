"use client";

import { useEffect } from "react";

export function PrintControls() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex gap-3">
      <button
        onClick={() => window.close()}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Tutup Tab
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Cetak Sekarang
      </button>
    </div>
  );
}
