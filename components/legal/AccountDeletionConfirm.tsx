"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CheckCircle, Clock, Info, Trash } from "@/components/ui/icons";
import { ERASED_DATA, RETAINED_DATA } from "@/lib/erasure-copy";

interface ErasureResult {
  status: string;
  completed: boolean;
  accountErased: boolean;
  message: string;
  resolutionSteps: string[];
  retained: string[];
}

function DataList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] leading-6 text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ResultView({ result }: { result: ErasureResult }) {
  const held = result.status === "PENDING_RECONCILIATION";
  const title = result.completed
    ? "Penghapusan selesai"
    : held
      ? "Penghapusan ditunda"
      : "Penghapusan belum selesai";
  const Icon = result.completed ? CheckCircle : held ? Info : Clock;
  return (
    <div className="space-y-5">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-400">
          <Icon className="text-2xl" />
        </span>
        <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">{title}</h2>
        <p className="text-sm leading-6 text-muted">{result.message}</p>
      </div>
      {result.resolutionSteps.length > 0 ? (
        <DataList title="Yang perlu diselesaikan" items={result.resolutionSteps} />
      ) : null}
      {result.completed || result.accountErased ? (
        <DataList title="Data yang tetap disimpan dan alasannya" items={result.retained} />
      ) : null}
    </div>
  );
}

/** Reviews what will be erased and confirms a public request with its one-time token. */
export function AccountDeletionConfirm({ token }: { token: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ErasureResult | null>(null);

  if (!token) {
    return (
      <p role="alert" className="text-sm leading-6 text-status-error">
        Tautan konfirmasi tidak lengkap. Buka tautan dari email kami, atau ajukan
        permintaan baru di halaman Hapus Akun.
      </p>
    );
  }

  async function onConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account-deletion-requests/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }
      setResult(data as ErasureResult);
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  if (result) return <ResultView result={result} />;

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20"
        >
          {error}
        </div>
      ) : null}
      <DataList title="Yang akan dihapus" items={ERASED_DATA} />
      <DataList title="Yang tetap disimpan dan alasannya" items={RETAINED_DATA} />
      <p className="rounded-2xl border border-border bg-surface/50 p-4 text-[13px] leading-6 text-muted">
        Jika masih ada saldo, pencairan, sesi setoran, atau trip yang belum
        selesai, penghapusan ditunda tanpa menghapus data apa pun dan akun tetap
        dapat Anda gunakan untuk menyelesaikannya. Saldo tidak dihanguskan.
      </p>
      <Button
        type="button"
        size="lg"
        variant="danger"
        className="h-12 w-full rounded-xl sm:h-13"
        disabled={loading}
        onClick={onConfirm}
      >
        <Trash className="mr-2 text-lg" />
        {loading ? "Memproses..." : "Konfirmasi Penghapusan Akun"}
      </Button>
    </div>
  );
}
