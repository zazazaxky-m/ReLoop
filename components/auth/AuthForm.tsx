"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, FormField, Input } from "@/components/ui";

type Mode = "login" | "register";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isRegister = mode === "register";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });

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

      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-11 rounded-xl border-emerald-950/10 bg-[#fbfdfb] px-4 text-[15px] shadow-none hover:border-emerald-900/20 sm:h-12";

  return (
    <form
      onSubmit={onSubmit}
      className={isRegister ? "grid gap-3.5 sm:grid-cols-2 sm:gap-4" : "space-y-4"}
    >
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error sm:col-span-2">
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
        <Input
          id="password"
          className={inputClass}
          type="password"
          value={form.password}
          onChange={update("password")}
          placeholder="••••••••"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        className={`h-12 w-full rounded-xl bg-emerald-700 shadow-[0_10px_24px_rgba(4,120,87,0.2)] hover:bg-emerald-800 sm:h-13 ${
          isRegister ? "sm:col-span-2" : "mt-2"
        }`}
        disabled={loading}
      >
        {loading ? "Memproses..." : isRegister ? "Buat akun" : "Masuk"}
      </Button>

      <p
        className={`text-center text-sm text-emerald-950/55 ${
          isRegister ? "sm:col-span-2" : "pt-1"
        }`}
      >
        {isRegister ? "Sudah punya akun? " : "Belum punya akun? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-bold text-emerald-700 hover:underline"
        >
          {isRegister ? "Masuk" : "Daftar"}
        </Link>
      </p>
    </form>
  );
}
