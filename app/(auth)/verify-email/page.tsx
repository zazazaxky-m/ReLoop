import type { Metadata } from "next";
import { EmailTokenAction } from "@/components/auth/EmailTokenAction";
import { LinkTokenCapture } from "@/components/auth/LinkTokenCapture";

export const metadata: Metadata = {
  title: "Verifikasi Email",
  description: "Verifikasi alamat email akun ReLoop dari tautan yang dikirim ke email Anda.",
  robots: { index: false, follow: false },
  // The single-use token arrives in the URL fragment: never send this URL to another site.
  referrer: "no-referrer",
};

/** A03: proves the signed-in account reads its email; see proxy.ts for the page headers. */
export default function VerifyEmailPage() {
  return (
    <div className="space-y-7">
      <LinkTokenCapture kind="verify-email" />
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Keamanan akun
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] [word-spacing:0.05em] text-foreground">
          Verifikasi email
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Konfirmasi bahwa alamat email ini milik akun ReLoop Anda.
        </p>
      </div>
      <EmailTokenAction kind="verify-email" />
    </div>
  );
}
