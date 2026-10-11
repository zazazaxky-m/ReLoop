import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Daftar Gratis",
  description:
    "Buat akun ReLoop gratis: setor sampah daur ulang di mesin ReLoop terdekat, kumpulkan reward, dan cairkan saldo dengan proses yang transparan.",
  alternates: { canonical: "/register" },
};

export default function RegisterPage() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Mulai perjalananmu
        </p>
        <h1 className="mt-1.5 text-2xl font-black tracking-[-0.045em] [word-spacing:0.05em] text-foreground sm:text-3xl">
          Buat akun ReLoop
        </h1>
        <p className="mt-1 text-sm leading-5 text-muted sm:mt-2 sm:leading-6">
          Satu menit untuk mulai memberi dampak.
        </p>
      </div>
      <AuthForm mode="register" />
    </div>
  );
}
