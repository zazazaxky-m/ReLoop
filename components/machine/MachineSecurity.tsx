"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ShieldCheck } from "@/components/ui/icons";

export function MachineSecurity({
  machineId,
  machineCode,
  initialSecret,
}: {
  machineId: string;
  machineCode: string;
  initialSecret: string | null;
}) {
  const [secret, setSecret] = useState(initialSecret);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (
      !window.confirm(
        "Rotasi secret akan menonaktifkan secret lama. Mesin/simulator harus dikonfigurasi ulang. Lanjut?",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/machines/${machineId}/rotate-secret`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal merotasi secret");
        return;
      }
      setSecret(d.ingestSecret);
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable on http; ignore */
    }
  }

  const masked = secret ? `${secret.slice(0, 4)}${"•".repeat(18)}` : "-";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-brand-600" />
          Keamanan Mesin (Ingest Secret)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-status-error">
            {error}
          </div>
        ) : null}
        <p className="text-muted">
          Mesin menandatangani setiap event dengan secret ini (HMAC-SHA256). Secret tidak
          pernah dikirim polos — hanya tanda tangannya. Jaga kerahasiaannya.
        </p>
        <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 font-mono text-xs break-all">
          {secret ? (revealed ? secret : masked) : "Belum ada secret"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)} disabled={!secret}>
            {revealed ? "Sembunyikan" : "Tampilkan"}
          </Button>
          <Button size="sm" variant="outline" onClick={copy} disabled={!secret}>
            {copied ? "Tersalin!" : "Salin"}
          </Button>
          <Button size="sm" variant="danger" onClick={rotate} disabled={busy}>
            {busy ? "Memproses..." : "Rotasi Secret"}
          </Button>
        </div>
        <div className="rounded-xl bg-mint/40 px-3 py-2 text-xs text-brand-800">
          <p className="font-semibold">Jalankan simulator:</p>
          <p className="mt-1 font-mono break-all">
            python simulator.py -m {machineCode} --secret &lt;SECRET&gt; ...
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
