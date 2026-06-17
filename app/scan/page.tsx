import { Suspense } from "react";
import { ScanPageClient } from "@/components/scan/ScanPageClient";

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center text-sm text-muted">Memuat...</div>
      }
    >
      <ScanPageClient />
    </Suspense>
  );
}
