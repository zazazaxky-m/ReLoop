import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Lupa Kata Sandi",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
          Pemulihan akun
        </p>
        <h1 className="mt-2.5 text-4xl font-bold leading-none tracking-[-0.06em] text-foreground sm:text-5xl">
          Lupa kata sandi?
        </h1>
        <p className="mt-2.5 text-[15px] leading-6 text-muted">
          Masukkan email akunmu. Kami akan mengirimkan tautan untuk mengatur
          ulang kata sandi.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
