import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/lib/link-token";

export const metadata: Metadata = {
  title: "Daftar Gratis",
  description:
    "Buat akun ReLoop gratis: setor sampah daur ulang di mesin ReLoop terdekat, kumpulkan reward, dan cairkan saldo dengan proses yang transparan.",
  alternates: { canonical: "/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
          Mulai perjalananmu
        </p>
        <h1 className="mt-2.5 text-4xl font-bold leading-none tracking-[-0.06em] text-foreground sm:text-5xl">
          Buat akun ReLoop
        </h1>
        <p className="mt-2.5 text-[15px] leading-6 text-muted">
          Satu menit untuk mulai memberi dampak.
        </p>
      </div>
      <AuthForm mode="register" next={safeNextPath(next)} />
    </div>
  );
}
