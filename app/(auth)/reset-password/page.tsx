import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

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
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] text-foreground">
          Atur ulang kata sandi
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Buat kata sandi baru untuk akun Anda. Minimal 6 karakter.
        </p>
      </div>
      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
