import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { CheckCircle } from "@/components/ui/icons";
import { safeNextPath } from "@/lib/link-token";

export const metadata: Metadata = {
  title: "Masuk",
  description:
    "Masuk ke akun ReLoop untuk memantau setoran sampah, saldo poin, dan pencairan, atau mengelola mesin dan penjemputan sampah di organisasimu.",
  alternates: { canonical: "/login" },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string }>;
}) {
  const { reset, next } = await searchParams;

  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Selamat datang kembali
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] [word-spacing:0.05em] text-foreground">
          Masuk ke ReLoop
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Lanjutkan aksi baikmu dari sini.
        </p>
      </div>
      {reset === "1" ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm font-medium text-brand-800 dark:border-brand-900/30 dark:bg-brand-950/20 dark:text-brand-400">
          <CheckCircle className="shrink-0 text-lg" />
          Kata sandi berhasil diperbarui. Silakan masuk.
        </div>
      ) : null}
      <AuthForm mode="login" next={safeNextPath(next)} />
    </div>
  );
}
