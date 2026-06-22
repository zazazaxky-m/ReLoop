"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { QrCode, Recycle } from "@/components/ui/icons";
import { formatRupiah } from "@/lib/format";
import { QrScanner } from "./QrScanner";

interface SessionInfo {
  id: string;
  status: string;
}

interface MachineInfo {
  name: string;
  machineCode: string;
  organizationName: string;
  supportedWasteTypes?: { id: string; name: string }[];
}

/** Extracts machine code (m) + token (t) from a scanned QR payload (URL or query). */
function parseScanPayload(text: string): { m: string; t: string } | null {
  const raw = text.trim();
  try {
    const url = new URL(raw, window.location.origin);
    const m = url.searchParams.get("m");
    const t = url.searchParams.get("t");
    if (m && t) return { m, t };
  } catch {
    /* not a URL, fall through */
  }
  // Fallback: a bare "m=...&t=..." string.
  try {
    const sp = new URLSearchParams(raw.includes("?") ? raw.split("?")[1] : raw);
    const m = sp.get("m");
    const t = sp.get("t");
    if (m && t) return { m, t };
  } catch {
    /* ignore */
  }
  return null;
}

export function ScanPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialM = searchParams.get("m") ?? "";
  const initialT = searchParams.get("t") ?? "";

  const [code, setCode] = useState(initialM);
  const [token, setToken] = useState(initialT);
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [items, setItems] = useState<
    { id: string; wasteType: { name: string }; rewardAmount: number; status: string }[]
  >([]);
  const [finishing, setFinishing] = useState(false);
  const startedRef = useRef(false);

  const refreshSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (!res.ok) return;
    const data = await res.json();
    setSession(data.session);
    setItems(data.session.items ?? []);
  }, []);

  const startSession = useCallback(
    async (m: string, t: string) => {
      if (!m || !t) {
        setError("Parameter QR tidak lengkap. Scan ulang dari mesin.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineCode: m, token: t }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Gagal memulai sesi");
        setSession(data.session);
        setMachine(data.machine);
        if (data.session.id) await refreshSession(data.session.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan");
      } finally {
        setLoading(false);
      }
    },
    [refreshSession],
  );

  // Method 1: arrived via QR deep-link (?m=&t=) → auto-start once.
  useEffect(() => {
    if (startedRef.current || !initialM || !initialT) return;
    startedRef.current = true;
    const id = setTimeout(() => {
      void startSession(initialM, initialT);
    }, 0);
    return () => clearTimeout(id);
  }, [initialM, initialT, startSession]);

  // Method 2: in-app camera scan result.
  const handleScanned = useCallback(
    (text: string) => {
      setCameraOn(false);
      const parsed = parseScanPayload(text);
      if (!parsed) {
        setError("QR tidak dikenali. Pastikan ini QR mesin ReLoop.");
        return;
      }
      setCode(parsed.m);
      setToken(parsed.t);
      void startSession(parsed.m, parsed.t);
    },
    [startSession],
  );

  useEffect(() => {
    if (!session?.id || ["COMPLETED", "CANCELLED", "EXPIRED"].includes(session.status)) return;
    const t = setInterval(() => refreshSession(session.id), 5000);
    return () => clearInterval(t);
  }, [session?.id, session?.status, refreshSession]);

  async function finishSession() {
    if (!session) return;
    setFinishing(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyelesaikan sesi");
      setSession(data.session);
      router.push("/dashboard/user/wallet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setFinishing(false);
    }
  }

  const totalReward = items.reduce((s, i) => s + (i.rewardAmount ?? 0), 0);
  const showIntro = !session && !loading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scan Mesin"
        description="Pindai kode QR pada mesin untuk memulai sesi penyetoran."
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          {code && token ? (
            <div className="mt-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => startSession(code, token)}
                disabled={loading}
              >
                Coba Lagi
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showIntro ? (
        <Card>
          <CardContent className="space-y-4 py-8">
            {cameraOn ? (
              <QrScanner onResult={handleScanned} onCancel={() => setCameraOn(false)} />
            ) : (
              <div className="text-center">
                <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-brand-50 text-2xl text-brand-600">
                  <QrCode />
                </span>
                {code && token ? (
                  <p className="mb-4 text-sm text-muted">
                    QR terdeteksi untuk mesin <strong>{code}</strong>.
                  </p>
                ) : (
                  <p className="mb-4 text-sm text-muted">
                    Pindai QR pada layar mesin pakai kamera, atau buka link QR yang
                    memuat <code className="text-xs">?m=KODE&t=TOKEN</code>.
                  </p>
                )}
                <div className="flex flex-col items-center gap-2">
                  <Button onClick={() => setCameraOn(true)} size="lg">
                    <QrCode className="mr-2" />
                    Scan dengan Kamera
                  </Button>
                  {code && token ? (
                    <Button
                      variant="secondary"
                      onClick={() => startSession(code, token)}
                      disabled={loading}
                    >
                      Mulai Sesi Setor
                    </Button>
                  ) : (
                    <Link href="/dashboard/user" className="text-sm text-brand-600">
                      Kembali ke Dashboard
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {loading && !session ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted">
            Memvalidasi QR dan memulai sesi...
          </CardContent>
        </Card>
      ) : null}

      {session && machine ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{machine.name}</CardTitle>
              <CardDescription>
                {machine.organizationName} · {machine.machineCode}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">Status sesi</span>
                <StatusBadge status={session.status} />
              </div>
              <p className="text-sm text-muted">
                Masukkan botol atau kaleng ke mesin. Reward dicatat setelah barang
                melewati acceptance point. Gunakan simulator Python untuk demo.
              </p>
              {machine.supportedWasteTypes?.length ? (
                <div className="flex flex-wrap gap-2">
                  {machine.supportedWasteTypes.map((w) => (
                    <span
                      key={w.id}
                      className="rounded-lg bg-mint px-2.5 py-1 text-xs font-medium text-brand-700"
                    >
                      {w.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Item dalam sesi</CardTitle>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted">
                  Belum ada item. Jalankan simulator untuk mengirim event deposit.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between py-3 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <Recycle className="text-brand-500" />
                        {item.wasteType.name}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        {item.rewardAmount > 0 ? (
                          <span className="font-medium text-brand-700">
                            {formatRupiah(item.rewardAmount)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {totalReward > 0 ? (
                <p className="mt-4 text-right text-sm font-semibold text-brand-700">
                  Total sesi: {formatRupiah(totalReward)}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {session.status !== "COMPLETED" && session.status !== "CANCELLED" ? (
            <Button
              className="w-full"
              size="lg"
              onClick={finishSession}
              disabled={finishing}
            >
              {finishing ? "Menyelesaikan..." : "Selesai Setor"}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
