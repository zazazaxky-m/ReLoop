"use client";

import { useState } from "react";
import { Button, Card, CardContent } from "@/components/ui";
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
  const [expanded, setExpanded] = useState(false);
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
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
      >
        <span className="flex items-center gap-2 font-bold text-foreground">
          <ShieldCheck className="text-brand-600" />
          Keamanan Mesin
        </span>
        <span className="text-xs font-semibold text-brand-700">
          {expanded ? "Tutup" : "Kelola secret"}
        </span>
      </button>
      {expanded ? (
        <CardContent className="space-y-3 border-t border-border text-sm">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-status-error">
              {error}
            </div>
          ) : null}
          <p className="text-muted">
            Event mesin ditandatangani menggunakan HMAC-SHA256. Jaga secret ini tetap rahasia.
          </p>
          <div className="break-all rounded-xl border border-border bg-slate-50 px-3 py-2 font-mono text-xs">
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
            <p className="font-semibold">Konfigurasi simulator</p>
            <p className="mt-1 break-all font-mono">
              python simulator.py -m {machineCode} --secret &lt;SECRET&gt; ...
            </p>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
