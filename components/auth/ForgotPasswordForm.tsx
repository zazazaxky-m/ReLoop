"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, FormField, Input } from "@/components/ui";
import { CheckCircle } from "@/components/ui/icons";

const inputClass =
  "h-11 rounded-xl border-border bg-surface px-4 text-[15px] shadow-none hover:border-muted sm:h-12";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }
      setDevUrl(typeof data?.devResetUrl === "string" ? data.devResetUrl : null);
      setSent(true);
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-400">
          <CheckCircle className="text-2xl" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">
            Cek emailmu
          </h2>
          <p className="text-sm leading-6 text-muted">
            Jika <span className="font-semibold text-foreground">{email}</span>{" "}
            terdaftar, kami telah mengirimkan tautan untuk mengatur ulang kata
            sandi. Tautan berlaku selama 1 jam.
          </p>
        </div>

        {devUrl ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-left text-xs dark:border-amber-900/30 dark:bg-amber-950/20">
            <p className="font-bold text-amber-700 dark:text-amber-500">
              Mode pengembangan
            </p>
            <p className="mt-1 text-muted">
              Belum ada layanan email. Gunakan tautan ini untuk melanjutkan:
            </p>
            <Link
              href={devUrl.replace(/^.*\/reset-password/, "/reset-password")}
              className="mt-1.5 block break-all font-semibold text-brand-700 hover:underline dark:text-brand-400"
            >
              {devUrl}
            </Link>
          </div>
        ) : null}

        <Link
          href="/login"
          className="inline-block text-sm font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          Kembali ke halaman masuk
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20"
        >
          {error}
        </div>
      ) : null}

      <FormField label="Email" htmlFor="email" required>
        <Input
          id="email"
          className={inputClass}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nama@email.com"
          autoComplete="email"
          required
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        className="mt-2 h-12 w-full rounded-xl bg-brand-600 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-700 sm:h-13"
        disabled={loading}
      >
        {loading ? "Mengirim..." : "Kirim tautan reset"}
      </Button>

      <p className="pt-1 text-center text-sm text-muted">
        Ingat kata sandimu?{" "}
        <Link
          href="/login"
          className="font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          Masuk
        </Link>
      </p>
    </form>
  );
}
