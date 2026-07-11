"use client";

import { useState } from "react";
import { Button, FormField, Input, Textarea } from "@/components/ui";
import { CheckCircle, Trash } from "@/components/ui/icons";

const inputClass =
  "h-11 rounded-xl border-border bg-surface px-4 text-[15px] shadow-none hover:border-muted sm:h-12";

const dataTypeOptions = [
  "Profil (nama, email, nomor telepon, foto)",
  "Akun pencairan (DANA/OVO/GoPay/Bank)",
  "Riwayat setoran & reward",
  "Riwayat pencairan poin",
  "Riwayat travel program",
  "Notifikasi & preferensi",
  "Foto dokumentasi laporan",
] as const;

export function AccountDeletionForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm) {
      setError(
        "Anda harus menyetujui bahwa semua data pribadi akan dihapus permanen.",
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/account-deletion-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason }),
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
            Kami telah menerima permintaan penghapusan akun untuk{" "}
            <span className="font-semibold text-foreground">{email}</span>. Tim
            kami akan memverifikasi identitas Anda dan menghapus akun dalam
            waktu paling lambat 7 (tujuh) hari kerja. Anda akan menerima
            konfirmasi melalui email setelah proses selesai.
          </p>
        </div>
        <p className="text-xs text-muted">
          Pertanyaan? Hubungi{" "}
          <a
            href="mailto:privacy@reloop.id"
            className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            privacy@reloop.id
          </a>
        </p>
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
        label="Email akun yang akan dihapus"
        htmlFor="deletion-email"
        required
        hint="Gunakan email yang terdaftar di aplikasi ReLoop."
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

      <FormField
        label="Alasan (opsional)"
        htmlFor="deletion-reason"
        hint="Bantu kami memahami mengapa Anda ingin menghapus akun. Tidak wajib diisi."
      >
        <Textarea
          id="deletion-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Ceritakan pengalaman Anda..."
        />
      </FormField>

      <label className="flex items-start gap-3 rounded-2xl border border-border bg-surface/50 p-4 text-[13px] leading-6 text-muted">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand-600 focus:ring-brand-500"
          required
        />
        <span>
          Saya memahami bahwa setelah dihapus,{" "}
          <span className="font-bold text-foreground">
            akun dan semua data pribadi saya tidak dapat dipulihkan
          </span>
          . Sisa saldo reward yang belum dicairkan akan hangus. Saya tetap
          bisa membuat akun baru di kemudian hari dengan email yang berbeda.
        </span>
      </label>

      <Button
        type="submit"
        size="lg"
        variant="danger"
        className="h-12 w-full rounded-xl sm:h-13"
        disabled={loading}
      >
        <Trash className="mr-2 text-lg" />
        {loading ? "Mengirim permintaan..." : "Ajukan Penghapusan Akun"}
      </Button>
    </form>
  );
}
