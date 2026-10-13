import type { Metadata } from "next";
import { Trash } from "@/components/ui/icons";
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
    <article className="mx-auto max-w-xl space-y-6">
      <header className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-status-error dark:border-red-900/40 dark:bg-red-950/30">
          <Trash className="text-sm" /> Hapus Akun
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] text-foreground">
          Konfirmasi Penghapusan Akun
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Tinjau data yang akan dihapus dan yang tetap disimpan. Penghapusan
          baru dimulai setelah Anda menekan tombol konfirmasi.
        </p>
      </header>
      <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <AccountDeletionConfirm token={typeof token === "string" ? token : null} />
      </section>
    </article>
  );
}
