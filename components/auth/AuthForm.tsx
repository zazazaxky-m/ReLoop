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
      setForm((f) => ({ ...f, [key]: e.target.value }));
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {isRegister ? (
        <FormField label="Nama lengkap" htmlFor="name" required>
          <Input
            id="name"
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
          type="email"
          value={form.email}
          onChange={update("email")}
          placeholder="nama@email.com"
          autoComplete="email"
          required
        />
      </FormField>

      {isRegister ? (
        <FormField label="Nomor HP" htmlFor="phone" hint="Opsional">
          <Input
            id="phone"
            value={form.phone}
            onChange={update("phone")}
            placeholder="08xxxxxxxxxx"
            autoComplete="tel"
          />
        </FormField>
      ) : null}

      <FormField label="Password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          value={form.password}
          onChange={update("password")}
          placeholder="••••••••"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
        />
      </FormField>

      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading
          ? "Memproses..."
          : isRegister
            ? "Buat Akun"
            : "Masuk"}
      </Button>

      <p className="text-center text-sm text-muted">
        {isRegister ? "Sudah punya akun? " : "Belum punya akun? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-medium text-brand-600 hover:underline"
        >
          {isRegister ? "Masuk" : "Daftar"}
        </Link>
      </p>
    </form>
  );
}
