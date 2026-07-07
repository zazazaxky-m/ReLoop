"use client";

import { useEffect } from "react";

export default function MachineDisplayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[machine-display] render error:", error);
    // Kiosks are unattended: self-heal by retrying automatically.
    const timer = setTimeout(() => reset(), 5000);
    return () => clearTimeout(timer);
  }, [error, reset]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-center text-slate-200">
      <h2 className="text-2xl font-semibold">Layar sedang dipulihkan</h2>
      <p className="max-w-md text-sm text-slate-400">
        Terjadi gangguan sementara pada tampilan mesin. Layar akan mencoba
        memuat ulang secara otomatis.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Muat ulang sekarang
      </button>
    </div>
  );
}
