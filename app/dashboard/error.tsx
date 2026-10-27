"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { AlertTriangle } from "@/components/ui/icons";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-error/10">
        <AlertTriangle className="text-2xl text-status-error" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          Terjadi kesalahan
        </h2>
        <p className="max-w-md text-sm text-muted">
          Halaman ini gagal dimuat. Coba muat ulang; jika masih bermasalah,
          hubungi tim dukungan.
        </p>
      </div>
      <Button onClick={reset}>Coba lagi</Button>
    </div>
  );
}
