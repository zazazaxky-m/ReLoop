import type { Metadata } from "next";
import { EmailTokenAction } from "@/components/auth/EmailTokenAction";
import { LinkTokenCapture } from "@/components/auth/LinkTokenCapture";

export const metadata: Metadata = {
  title: "Terima Undangan Travel Agent",
  description: "Terima undangan travel agent ReLoop dari tautan yang dikirim ke email undangan.",
  robots: { index: false, follow: false },
  // The single-use token arrives in the URL fragment: never send this URL to another site.
  referrer: "no-referrer",
};

/**
 * A03: the invitation is accepted only by the signed-in account whose email
 * is the invited address, with the token from that mailbox. proxy.ts adds
 * `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `no-store`.
 */
export default function AcceptInvitationPage() {
  return (
    <div className="space-y-7">
      <LinkTokenCapture kind="accept-invitation" />
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-600 dark:text-brand-400">
          Undangan travel agent
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] [word-spacing:0.05em] text-foreground">
          Terima undangan
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Setelah undangan diterima, akun Anda dapat melihat trip rombongan travel agent tersebut.
        </p>
      </div>
      <EmailTokenAction kind="accept-invitation" />
    </div>
  );
}
