import Image from "next/image";
import Link from "next/link";
import { CheckCircle } from "@/components/ui/icons";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-dvh overflow-hidden bg-background lg:grid lg:grid-cols-[minmax(420px,44%)_1fr]">
      <aside className="relative hidden h-dvh overflow-hidden bg-brand-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="absolute -bottom-44 -left-32 h-96 w-96 rounded-full border-[64px] border-lime-300/10" />
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-emerald-700/20 blur-3xl" />

        <Link href="/" className="relative inline-flex self-start rounded-2xl bg-surface px-4 py-2.5">
          <Image
            src="/reloop-logo-name.svg"
            alt="ReLoop"
            width={145}
            height={43}
            priority
            className="h-10 w-auto"
          />
        </Link>

        <div className="relative z-10 max-w-lg">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">
            Sampah selesai. Dampak dimulai.
          </p>
          <h2 className="mt-5 text-4xl font-black leading-[1.05] tracking-[-0.05em] xl:text-5xl">
            Satu akun untuk setiap aksi baikmu.
          </h2>
          <div className="mt-8 space-y-4 text-sm font-medium text-white/80">
            <p className="flex items-center gap-3">
              <CheckCircle className="text-lg text-lime-300" />
              Setoran dan reward tercatat otomatis.
            </p>
            <p className="flex items-center gap-3">
              <CheckCircle className="text-lg text-lime-300" />
              Pantau dampakmu dari satu dashboard.
            </p>
          </div>
        </div>

        <p className="relative text-xs text-white/30">
          &copy; {new Date().getFullYear()} ReLoop
        </p>
      </aside>

      <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-brand-100/65 to-transparent dark:from-brand-950/40 lg:hidden" />

        <header className="relative flex h-18 items-center px-5 sm:px-8 lg:hidden">
          <Link href="/" className="flex items-center">
            <Image
              src="/reloop-logo-name.svg"
              alt="ReLoop"
              width={125}
              height={37}
              priority
              className="h-9 w-auto"
            />
          </Link>
        </header>

        <div className="relative mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-3 sm:px-10 sm:py-5 lg:px-12 lg:py-6">
          <div className="w-full rounded-[1.5rem] border border-border bg-surface p-5 shadow-[0_24px_70px_rgba(6,78,59,0.1)] dark:shadow-none sm:rounded-[2rem] sm:p-7 lg:p-8">
            {children}
          </div>
          <Link
            href="/"
            className="mx-auto mt-3 text-xs font-semibold text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-400 sm:mt-4"
          >
            ← Kembali ke halaman utama
          </Link>
        </div>
      </main>
    </div>
  );
}
