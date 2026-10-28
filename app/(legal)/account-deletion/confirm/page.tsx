import type { Metadata } from "next";
import { AccountDeletionConfirm } from "@/components/legal/AccountDeletionConfirm";

export const metadata: Metadata = {
  title: "Konfirmasi Hapus Akun",
  description: "Konfirmasi permintaan penghapusan akun ReLoop dari tautan yang dikirim ke email akun.",
  robots: { index: false, follow: false },
  // The one-time token is in the URL: never send it to another site.
  referrer: "no-referrer",
};

export default async function AccountDeletionConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return (
    <article className="mx-auto max-w-xl space-y-8">
      <header>
        <p className="inline-block -rotate-[1.5deg] rounded-[3px] bg-lime px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink">Hapus Akun</p>
        <h1 className="mt-5 text-4xl font-bold leading-[1.02] tracking-[-0.06em] text-foreground sm:text-5xl">
          Konfirmasi Penghapusan Akun
        </h1>
        <p className="mt-5 text-[15px] leading-7 text-muted">
          Tinjau data yang akan dihapus dan yang tetap disimpan. Penghapusan
          baru dimulai setelah Anda menekan tombol konfirmasi.
        </p>
      </header>
      <section className="rounded-2xl border border-border bg-surface p-6">
        <AccountDeletionConfirm token={typeof token === "string" ? token : null} />
      </section>
    </article>
  );
}
