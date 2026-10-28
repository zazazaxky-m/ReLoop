/* eslint-disable @next/next/no-img-element -- Decorative landing artwork:
   next/image adds an inline style that our CSP blocks. */
import { BrandLogo } from "@/components/BrandLogo";
import { preloadEditorialFonts } from "@/lib/fonts";
import Link from "next/link";

const BAND = "SETOR. PUTAR. ULANG.";

function BandItems({ markClassName }: { markClassName: string }) {
  return [0, 1, 2].map((i) => (
    <span key={i} className="inline-flex items-center gap-3.5">
      <img src="/landing/mark.svg" alt="" className={`${markClassName} brightness-[.18] saturate-50`} />
      {BAND}
    </span>
  ));
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  preloadEditorialFonts();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(420px,44%)_1fr]">
      {/* Decorative poster from the landing artwork: keep the page's <h1> (in the form) as the first heading. */}
      <aside
        aria-hidden="true"
        className="light-island relative hidden h-dvh overflow-hidden border-r border-rule-strong bg-background text-foreground lg:block"
      >
        <img src="/landing/logo.svg" alt="" className="absolute left-9 top-8 z-[3] h-9 w-auto" />
        <img src="/landing/heading-v2.webp" alt="" className="absolute left-[30px] top-[104px] z-[1] w-[78%]" />
        <img
          src="/landing/bottle-v2.webp"
          alt=""
          className="absolute -right-10 top-[210px] z-[2] w-[52%] rotate-6 drop-shadow-[0_26px_22px_#00190c38]"
        />
        <img src="/landing/slogan-v2.webp" alt="" className="absolute left-[22px] top-[318px] z-[3] w-[60%]" />
        <div className="absolute -inset-x-[30px] bottom-[74px] z-[4] flex h-[50px] -rotate-[4.5deg] items-center gap-[26px] overflow-hidden whitespace-nowrap bg-lime pl-10 font-display text-[23px] tracking-[-0.01em]">
          <BandItems markClassName="w-[26px]" />
        </div>
        <p className="absolute bottom-[22px] left-9 z-[4] text-xs text-muted">
          &copy; {new Date().getFullYear()} ReLoop
        </p>
        {/* Paper grain over the artwork, as on the landing poster. */}
        <div className="pointer-events-none absolute inset-0 z-[6] bg-[url('/landing/paper-v2.webp')] bg-[length:900px] opacity-[0.42] mix-blend-multiply" />
      </aside>

      <main className="relative flex min-h-dvh flex-col overflow-y-auto">
        <header className="flex h-18 items-center justify-between gap-4 px-5 sm:px-8 lg:justify-end lg:px-10">
          <Link href="/" className="flex items-center lg:hidden">
            <BrandLogo
              width={125}
              height={37}
              priority
              className="h-9 w-auto"
            />
          </Link>
          <Link
            href="/"
            className="relative inline-flex items-center gap-2 text-[13px] font-bold text-foreground underline decoration-1 underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-2 hover:decoration-2"
          >
            <span aria-hidden="true">←</span>
            Kembali ke beranda
          </Link>
        </header>

        <div aria-hidden="true" className="overflow-hidden py-2 lg:hidden">
          <div className="-mx-4 flex h-7 -rotate-[1.5deg] items-center gap-5 whitespace-nowrap bg-lime px-4 font-display text-sm tracking-[-0.01em] text-ink">
            <BandItems markClassName="w-4" />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col justify-center px-5 py-8 sm:px-8 lg:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
