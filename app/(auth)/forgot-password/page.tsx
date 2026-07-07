import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Lupa Kata Sandi" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Pemulihan akun
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-foreground">
          Lupa kata sandi?
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Masukkan email akun Anda. Kami akan mengirimkan tautan untuk mengatur
          ulang kata sandi.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
