"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FormField, Input } from "@/components/ui";
import { Eye, EyeOff } from "@/components/ui/icons";

type Mode = "login" | "register";

interface MfaChallenge {
  challengeToken: string;
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isRegister = mode === "register";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = isRegister
        ? form
        : { email: form.email, password: form.password };
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Terjadi kesalahan");
        return;
      }

      if (data.requiresMfa && data.challengeToken) {
        setMfaChallenge({ challengeToken: data.challengeToken });
        setMfaCode("");
        return;
      }

      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  async function onMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallenge) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken: mfaChallenge.challengeToken,
          code: mfaCode,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Kode MFA tidak valid");
        return;
      }

      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-11 rounded-xl border-border bg-surface px-4 text-[15px] shadow-none hover:border-muted sm:h-12";

  if (mfaChallenge) {
    return (
      <form onSubmit={onMfaSubmit} className="space-y-4">
        {error ? (
          <div
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error outline-none focus-visible:ring-2 focus-visible:ring-status-error/40 dark:border-red-900/30 dark:bg-red-950/20"
          >
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-brand-800 dark:border-brand-900/30 dark:bg-brand-950/20 dark:text-brand-400">
          Password benar. Masukkan kode 6 digit dari aplikasi authenticator Anda.
        </div>

        <FormField label="Kode MFA" htmlFor="mfa-code" required>
          <Input
            id="mfa-code"
            className={inputClass}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            autoComplete="one-time-code"
            required
          />
        </FormField>

        <Button
          type="submit"
          size="lg"
          className="mt-2 h-12 w-full rounded-xl bg-brand-600 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 sm:h-13"
          disabled={loading}
        >
          {loading ? "Memverifikasi..." : "Verifikasi MFA"}
        </Button>

        <button
          type="button"
          className="w-full text-center text-sm font-semibold text-muted hover:text-foreground"
          onClick={() => {
            setMfaChallenge(null);
            setMfaCode("");
            setError(null);
          }}
        >
          Kembali ke login
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={isRegister ? "grid gap-3.5 sm:grid-cols-2 sm:gap-4" : "space-y-4"}
    >
      {error ? (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error outline-none focus-visible:ring-2 focus-visible:ring-status-error/40 dark:border-red-900/30 dark:bg-red-950/20 sm:col-span-2"
        >
          {error}
        </div>
      ) : null}

      {isRegister ? (
        <FormField label="Nama lengkap" htmlFor="name" required>
          <Input
            id="name"
            className={inputClass}
            value={form.name}
            onChange={update("name")}
            placeholder="Nama Anda"
            autoComplete="name"
            required
          />
        </FormField>
      ) : null}

      <FormField label="Email" htmlFor="email" required>
        <Input
          id="email"
          className={inputClass}
          type="email"
          value={form.email}
          onChange={update("email")}
          placeholder="nama@email.com"
          autoComplete="email"
          required
        />
      </FormField>

      {isRegister ? (
        <FormField label="Nomor HP" htmlFor="phone" required>
          <Input
            id="phone"
            className={inputClass}
            type="tel"
            value={form.phone}
            onChange={update("phone")}
            placeholder="08xxxxxxxxxx"
            autoComplete="tel"
            inputMode="numeric"
            pattern="[0-9]{9,16}"
            minLength={9}
            maxLength={16}
            required
          />
        </FormField>
      ) : null}

      <FormField label="Password" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            className={`${inputClass} pr-12`}
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={update("password")}
            placeholder="••••••••"
            autoComplete={isRegister ? "new-password" : "current-password"}
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

      {!isRegister ? (
        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            Lupa kata sandi?
          </Link>
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className={`h-12 w-full rounded-xl bg-brand-600 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 sm:h-13 ${
          isRegister ? "sm:col-span-2" : "mt-2"
        }`}
        disabled={loading}
      >
        {loading ? "Memproses..." : isRegister ? "Buat akun" : "Masuk"}
      </Button>

      <p
        className={`text-center text-sm text-muted ${
          isRegister ? "sm:col-span-2" : "pt-1"
        }`}
      >
        {isRegister ? "Sudah punya akun? " : "Belum punya akun? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          {isRegister ? "Masuk" : "Daftar"}
        </Link>
      </p>
    </form>
  );
}
