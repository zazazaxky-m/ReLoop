"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

const ELEMENT_ID = "reloop-qr-reader";

/**
 * In-browser QR scanner using the device camera (html5-qrcode).
 * Calls onResult with the decoded text, then stops the camera.
 * Requires a secure context (https or localhost) for camera access.
 */
export function QrScanner({
  onResult,
  onCancel,
}: {
  onResult: (text: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(ELEMENT_ID, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText: string) => {
            if (handledRef.current) return;
            handledRef.current = true;
            // Stop the camera before handing the result to the parent.
            scanner
              .stop()
              .catch(() => {})
              .finally(() => onResult(decodedText));
          },
          () => {
            /* per-frame decode failures are normal; ignore */
          },
        );
        if (!cancelled) setStarting(false);
      } catch (e) {
        if (cancelled) return;
        setStarting(false);
        const msg =
          e instanceof Error ? e.message : "Tidak dapat mengakses kamera";
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? "Izin kamera ditolak. Aktifkan izin kamera di browser lalu coba lagi."
            : /secure|https/i.test(msg)
              ? "Kamera butuh koneksi aman (https) atau localhost."
              : `Gagal membuka kamera: ${msg}`,
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        // stop() rejects if not currently scanning; swallow any error.
        Promise.resolve()
          .then(() => s.stop())
          .catch(() => {});
      }
    };
  }, [onResult]);

  return (
    <div className="space-y-3">
      <div
        id={ELEMENT_ID}
        className="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-border bg-black"
      />
      {starting && !error ? (
        <p className="text-center text-sm text-muted">Membuka kamera…</p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </p>
      ) : (
        <p className="text-center text-xs text-muted">
          Arahkan kamera ke QR pada layar mesin.
        </p>
      )}
      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Tutup Kamera
        </Button>
      </div>
    </div>
  );
}
