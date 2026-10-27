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
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
          Keamanan akun
        </p>
        <h1 className="mt-2.5 text-4xl font-bold leading-none tracking-[-0.06em] text-foreground sm:text-5xl">
          Verifikasi email
        </h1>
        <p className="mt-2.5 text-[15px] leading-6 text-muted">
          Konfirmasi bahwa alamat email ini milik akun ReLoop Anda.
        </p>
      </div>
      <EmailTokenAction kind="verify-email" />
    </div>
  );
}
