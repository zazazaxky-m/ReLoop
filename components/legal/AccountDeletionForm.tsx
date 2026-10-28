"use client";

import { useState } from "react";
import { Button, FormField, Input, Textarea } from "@/components/ui";
import { Info, Trash } from "@/components/ui/icons";

const inputClass = "h-12 px-4 text-[15px]";

export function AccountDeletionForm() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm) {
      setError("Centang pernyataan di bawah untuk melanjutkan.");
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
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }
      setSubmitted(
        typeof data?.message === "string"
          ? data.message
          : "Permintaan diterima. Tidak ada data yang dihapus sebelum pemilik akun mengonfirmasi.",
      );
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <Info className="text-2xl" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Menunggu konfirmasi
          </h2>
          <p className="text-sm leading-6 text-muted">{submitted}</p>
          <p className="text-sm leading-6 text-muted">
            Periksa kotak masuk{" "}
            <span className="font-semibold text-foreground">{email}</span> dan
            buka tautan konfirmasi (berlaku 24 jam, sekali pakai). Status
            penghapusan ditampilkan setelah Anda mengonfirmasi.
          </p>
        </div>
        <p className="text-xs text-muted">
          Tidak bisa membuka email itu atau masuk ke aplikasi? Hubungi{" "}
          <a
            href="mailto:privacy@reloop.id"
            className="font-semibold text-foreground underline decoration-1 underline-offset-2 hover:decoration-2"
          >
            privacy@reloop.id
          </a>{" "}
          untuk verifikasi identitas oleh tim kami.
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
        hint="Gunakan email yang terdaftar di aplikasi ReLoop. Tautan konfirmasi dikirim ke alamat ini."
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
        hint="Bantu kami memahami mengapa Anda ingin menghapus akun. Tidak wajib diisi dan ikut dihapus bersama akun."
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
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input-border accent-ink focus:ring-brand-400 dark:accent-lime"
          required
        />
        <span>
          Saya memahami bahwa setelah dikonfirmasi,{" "}
          <span className="font-bold text-foreground">
            data pribadi akun saya dihapus dan akun dinonaktifkan secara
            permanen
          </span>
          , sedangkan catatan transaksi tetap disimpan tanpa identitas saya.
          Jika masih ada saldo atau pencairan yang berjalan, penghapusan
          ditunda sampai selesai dan saldo saya tidak dihanguskan.
        </span>
      </label>

      <Button
        type="submit"
        size="lg"
        variant="danger"
        className="h-13 w-full"
        disabled={loading}
      >
        <Trash className="mr-2 text-lg" />
        {loading ? "Mengirim permintaan..." : "Ajukan Penghapusan Akun"}
      </Button>
    </form>
  );
}
