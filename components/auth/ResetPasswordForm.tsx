"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FormField, Input } from "@/components/ui";
import { Eye, EyeOff } from "@/components/ui/icons";

const inputClass =
  "h-11 rounded-xl border-border bg-surface px-4 text-[15px] shadow-none hover:border-muted sm:h-12";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-black tracking-[-0.03em] text-foreground">
          Tautan tidak valid
        </h2>
        <p className="text-sm leading-6 text-muted">
          Tautan reset tidak lengkap atau salah. Silakan minta tautan baru.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block text-sm font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          Minta tautan baru
        </Link>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Konfirmasi kata sandi tidak cocok");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }
      router.push("/login?reset=1");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
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

      <FormField label="Kata sandi baru" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            className={`${inputClass} pr-12`}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-2 my-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:hover:text-brand-400"
          >
            {showPassword ? <EyeOff className="text-lg" /> : <Eye className="text-lg" />}
          </button>
        </div>
      </FormField>

      <FormField label="Konfirmasi kata sandi" htmlFor="confirm" required>
        <Input
          id="confirm"
          className={inputClass}
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        className="mt-2 h-12 w-full rounded-xl bg-brand-600 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 sm:h-13"
        disabled={loading}
      >
        {loading ? "Menyimpan..." : "Simpan kata sandi baru"}
      </Button>

      <p className="pt-1 text-center text-sm text-muted">
        <Link
          href="/login"
          className="font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          Kembali ke halaman masuk
        </Link>
      </p>
    </form>
  );
}
