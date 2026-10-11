import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export const metadata: Metadata = {
  title: "Atur Ulang Kata Sandi",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Pemulihan akun
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] [word-spacing:0.05em] text-foreground">
          Atur ulang kata sandi
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Buat kata sandi baru untuk akunmu. Minimal {PASSWORD_MIN_LENGTH} karakter.
        </p>
      </div>
      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
