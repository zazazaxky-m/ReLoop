"use client";

import { useState } from "react";
import { Button, FormField, Input, Textarea } from "@/components/ui";
import { CheckCircle, ShieldCheck } from "@/components/ui/icons";

const inputClass =
  "h-11 rounded-xl border-border bg-surface px-4 text-[15px] shadow-none hover:border-muted sm:h-12";

const dataTypeOptions = [
  { id: "profile", label: "Profil (nama, email, nomor telepon, foto)" },
  { id: "payout", label: "Akun pencairan (DANA/OVO/GoPay/Bank)" },
  { id: "deposits", label: "Riwayat setoran & reward" },
  { id: "redemptions", label: "Riwayat pencairan poin" },
  { id: "travel", label: "Riwayat travel program" },
  { id: "notifications", label: "Notifikasi & preferensi" },
  { id: "reports", label: "Foto dokumentasi laporan" },
] as const;

export function DataDeletionForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError("Pilih minimal satu kategori data yang ingin dihapus.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason, dataTypes: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-400">
          <CheckCircle className="text-2xl" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">
            Permintaan diterima
          </h2>
          <p className="text-sm leading-6 text-muted">
            Kami telah menerima permintaan penghapusan sebagian data Anda.
            Tim kami akan memprosesnya dalam waktu 7 (tujuh) hari kerja dan
            mengirim konfirmasi ke{" "}
            <span className="font-semibold text-foreground">{email}</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20"
        >
          {error}
        </div>
      ) : null}

      <FormField
        label="Email akun Anda"
        htmlFor="deletion-email"
        required
        hint="Akun Anda tetap aktif. Hanya kategori data yang dipilih yang akan dihapus."
      >
        <Input
          id="deletion-email"
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nama@email.com"
          autoComplete="email"
          required
        />
      </FormField>

      <fieldset className="space-y-2.5">
        <legend className="text-sm font-bold text-foreground">
          Data yang ingin dihapus <span className="text-status-error">*</span>
        </legend>
        <div className="space-y-2 rounded-2xl border border-border bg-surface/50 p-3">
          {dataTypeOptions.map((opt) => (
            <label
              key={opt.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl p-2 transition-colors hover:bg-surface"
            >
              <input
                type="checkbox"
                checked={selected.has(opt.id)}
                onChange={() => toggle(opt.id)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-foreground">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          Centang semua yang ingin dihapus. Akun dan sisa saldo reward tidak
          akan terpengaruh.
        </p>
      </fieldset>

      <FormField
        label="Alasan (opsional)"
        htmlFor="deletion-reason"
      >
        <Textarea
          id="deletion-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Opsional: mengapa Anda ingin menghapus data ini?"
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        className="h-12 w-full rounded-xl bg-brand-600 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-700 sm:h-13"
        disabled={loading}
      >
        <ShieldCheck className="mr-2 text-lg" />
        {loading ? "Mengirim permintaan..." : "Ajukan Penghapusan Data"}
      </Button>
    </form>
  );
}
