"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

interface Payload {
  machineCode: string;
  machineName: string;
  status: string;
  rotationSeconds: number;
  expiresAt: string;
  scanUrl: string;
  qrDataUrl: string;
}

const statusMessage: Record<string, string> = {
  FULL: "Mesin penuh. Mohon gunakan mesin lain.",
  MAINTENANCE: "Mesin dalam perawatan.",
  ERROR: "Mesin mengalami gangguan.",
  OFFLINE: "Mesin sedang offline.",
};

export function MachineDisplay({ code, kiosk = false }: { code: string; kiosk?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPayload = useCallback(async () => {
    try {
      const res = await fetch(`/api/display/${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memuat mesin");
        return;
      }
      setError(null);
      setData(await res.json());
    } catch {
      setError("Tidak dapat terhubung ke server");
    }
  }, [code]);

  useEffect(() => {
    const boot = setTimeout(() => {
      void fetchPayload();
    }, 0);
    timer.current = setInterval(() => {
      void fetchPayload();
    }, 30000);
    const tick = setInterval(() => setNow(Date.now()), 500);
    const realtimeUrl =
      process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? "ws://localhost:3001/ws";
    const socket = new WebSocket(realtimeUrl);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (
          message.type === "event" &&
          message.data?.machineCode === code
        ) {
          void fetchPayload();
        }
      } catch {
        // Polling remains the fallback when realtime messages are malformed.
      }
    };
    return () => {
      clearTimeout(boot);
      if (timer.current) clearInterval(timer.current);
      clearInterval(tick);
      socket.close();
    };
  }, [code, fetchPayload]);

  const secondsLeft = data
    ? Math.max(0, Math.round((new Date(data.expiresAt).getTime() - now) / 1000))
    : 0;
  const isOnline = data?.status === "ONLINE";

  return (
    <div className={`flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-700 to-brand-900 text-white ${kiosk ? "cursor-none p-8" : "p-6"}`}>
      <div className="rounded-2xl bg-white px-4 py-2.5 shadow-lg">
        <Image
          src="/reloop-logo-name.svg"
          alt="ReLoop"
          width={150}
          height={45}
          priority
          className="h-10 w-auto"
        />
      </div>

      <div className={`mt-8 w-full rounded-3xl bg-white text-center text-foreground shadow-2xl ${kiosk ? "max-w-lg p-9" : "max-w-sm p-6"}`}>
        {error ? (
          <div className="py-12">
            <p className="text-lg font-semibold text-status-error">{error}</p>
            <p className="mt-1 text-sm text-muted">Kode: {code}</p>
          </div>
        ) : !data ? (
          <div className="py-16 text-muted">Memuat...</div>
        ) : isOnline ? (
          <>
            <p className="text-sm font-medium text-muted">{data.machineCode}</p>
            <h1 className="text-xl font-bold">{data.machineName}</h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.qrDataUrl}
              alt="QR dinamis mesin"
              className={`mx-auto mt-4 rounded-xl ${kiosk ? "h-80 w-80" : "h-64 w-64"}`}
            />
            <p className="mt-3 font-medium text-brand-700">
              Scan untuk mulai setor sampah
            </p>
            <p className="mt-1 text-xs text-muted">
              QR berotasi dalam {secondsLeft}s
            </p>
          </>
        ) : (
          <div className="py-12">
            <p className="text-sm font-medium text-muted">{data.machineCode}</p>
            <h1 className="mt-1 text-xl font-bold">{data.machineName}</h1>
            <p className="mt-6 text-lg font-semibold text-status-full">
              {statusMessage[data.status] ?? data.status}
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-brand-100">
        {kiosk ? "Mode kios aktif" : "Layar mesin"} &middot; QR dinamis dengan masa berlaku singkat
      </p>
    </div>
  );
}
