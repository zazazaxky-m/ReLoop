import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">
          Selamat datang kembali
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-emerald-950">
          Masuk ke ReLoop
        </h1>
        <p className="mt-2 text-sm leading-6 text-emerald-950/55">
          Lanjutkan aksi baikmu dari sini.
        </p>
      </div>
      <AuthForm mode="login" />
    </div>
  );
}
