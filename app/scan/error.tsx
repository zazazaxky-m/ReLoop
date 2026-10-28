"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { AlertTriangle } from "@/components/ui/icons";

export default function ScanError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[scan] render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-error/10">
        <AlertTriangle className="text-2xl text-status-error" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          Pemindai gagal dimuat
        </h2>
        <p className="text-sm text-muted">
          Pastikan izin kamera aktif, lalu coba lagi.
        </p>
      </div>
      <Button onClick={reset}>Coba lagi</Button>
    </div>
  );
}
