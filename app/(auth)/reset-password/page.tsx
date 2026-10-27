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
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
          Pemulihan akun
        </p>
        <h1 className="mt-2.5 text-4xl font-bold leading-none tracking-[-0.06em] text-foreground sm:text-5xl">
          Atur ulang kata sandi
        </h1>
        <p className="mt-2.5 text-[15px] leading-6 text-muted">
          Buat kata sandi baru untuk akunmu. Minimal {PASSWORD_MIN_LENGTH} karakter.
        </p>
      </div>
      <ResetPasswordForm token={token ?? ""} />
    </div>
  );
}
